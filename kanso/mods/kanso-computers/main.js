import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, exec, hc, home, readTextFile, run, shared } from "herdr";
import { localName } from "./platform-host.js";
import { pieces, runs } from "./pieces.js";
import { findExplainer, explainWith } from "./explain.js";
import { scanNearby } from "./nearby-scan.js";
import { lanOf } from "./nearby.js";
import { setupPrompt } from "./setup.js";
import { focusOn, tryOrAsync } from "./pure.js";
import { G, T, LH, DIALOG, tokens } from "./ui.js";
import { button } from "./ui-button.js";
import { dialog } from "./ui-dialog.js";
import { row } from "./ui-row.js";
import { stateBlock } from "./ui-state.js";
import { field, TextField } from "./ui-field.js";
import { code } from "./ui-code.js";
import { hcError, needsLogin, listedMachines, machineRecord, canRestore, addArgs as restoreArgs, rmArgs } from "./machines.js";
import {
  tailscalePaths, tailnet, planFor, choiceOf, addArgs, probeArgs, forgetArgs, reachOf, keySetup, advice, isAdded,
  sshConfigHosts, includesOf, splitTarget, validTarget, aliasOf, usesTailscaleSsh, nearbyOnly,
} from "./reach.js";

const PROBE_MS = 15000;
const FDA_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const failed = (error) => ({ code: 1, stdout: "", stderr: String(error?.message ?? error) });
const OS_WORD = { macos: "Mac", linux: "Linux", windows: "Windows", freebsd: "FreeBSD" };
const osWord = (os) => OS_WORD[String(os).toLowerCase()] ?? os;
const osIcon = (os) => (/^(macos|windows)$/i.test(os) ? "monitor" : "server");
const NETWORK = "computers.network";
const SIDEBAR_REFRESH = "kanso-spaces.retry-machine:";

async function findTailscale(platform) {
  for (const path of tailscalePaths(platform)) {
    const r = await tryOrAsync(() => exec(path, ["status", "--json"], { timeout: PROBE_MS }));
    if (r && (r.code === 0 || String(r.stdout ?? "").includes("{"))) return { path, net: tailnet(r.stdout) };
  }
  return { path: "", net: null };
}

async function includeFiles(pattern, platform) {
  const path = pattern.startsWith("~/") ? `${home()}/${pattern.slice(2)}` : /^([a-z]:)?[\\/]/i.test(pattern) ? pattern : `${home()}/.ssh/${pattern}`;
  if (!/[*?[]/.test(path) || platform === "windows") return [path];
  const r = await tryOrAsync(() => exec("sh", ["-c", 'for f in $1; do [ -f "$f" ] && printf "%s\\n" "$f"; done', "sh", path]));
  return String(r?.stdout ?? "").split("\n").filter(Boolean);
}

async function readHosts(platform, file = `${home()}/.ssh/config`, depth = 0) {
  const text = await tryOrAsync(() => readTextFile(file));
  if (!text) return [];
  const nested = depth < 16 ? await Promise.all(includesOf(text).map(async (p) => (await Promise.all((await includeFiles(p, platform)).map((f) => readHosts(platform, f, depth + 1)))).flat())) : [];
  return [...sshConfigHosts(text), ...nested.flat()];
}

export default class Computers extends View {
  init(_props, cx) {
    this.handle = focusOn(cx);
    this.platform = localName();
    this.tailscale = "";
    this.net = undefined;
    this.hosts = null;
    this.added = [];
    this.nearby = runs(NETWORK, pieces(shared)) ? undefined : null;
    this.dropped = {};
    this.explainer = undefined;
    this.jobs = {};
    this.macs = {};
    this.copied = "";
    this.typed = new TextField({ placeholder: "user@host" });
    this.typed.on("change", (_e, cx) => cx.notify());
    this.typed.on("submit", (_e, cx) => this.addTyped(cx));
    cx.spawn(async (cx) => {
      const [found, hosts] = await Promise.all([findTailscale(this.platform), readHosts(this.platform)]);
      this.tailscale = found.path;
      this.net = found.net;
      this.hosts = hosts;
      await this.refresh();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      this.explainer = await findExplainer();
      cx.notify();
    });
    if (this.nearby === undefined) cx.spawn(async (cx) => {
      this.nearby = await scanNearby(this.platform, cx.timer).catch(() => []);
      cx.notify();
    });
  }

  peers() {
    return this.net?.peers ?? [];
  }

  async refresh() {
    this.added = listedMachines(await tryOrAsync(() => hc(["machine", "ls", "--json"])));
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  typedKey() {
    const text = this.typed.value().trim();
    return validTarget(text) ? choiceOf(text, this.peers()).name ?? splitTarget(text).host : "";
  }

  addTyped(cx) {
    const key = this.typedKey();
    if (key) this.add(key, choiceOf(this.typed.value(), this.peers()), cx);
  }

  add(key, choice, cx) {
    if (this.jobs[key]?.phase === "adding") return;
    const plan = planFor(choice, { tailscale: this.tailscale, platform: this.platform });
    this.jobs[key] = { phase: "adding", choice, plan };
    cx.notify();
    cx.spawn(async (cx) => {
      await this.connect(key, plan);
      cx.notify();
    });
  }

  async connect(key, picked) {
    const plan = picked.pick ? await this.pickRoute(picked) : picked;
    if (plan.probe) {
      const probe = await exec("ssh", probeArgs(plan.target), { timeout: PROBE_MS }).catch(failed);
      const reach = reachOf(probe);
      if (reach !== "ready") return this.fail(key, reach, String(probe.stderr || probe.stdout).trim());
    }
    const error = hcError(await hc(addArgs(plan)).catch(failed));
    if (error) return this.fail(key, needsLogin(error) ? "password" : reachOf({ code: 1, stderr: error.message }), String(error.message ?? "").trim());
    delete this.jobs[key];
    delete this.dropped[key];
    if (key === this.typedKey()) this.typed.set_value("");
    await this.refresh();
    await this.checkMac(plan.name || plan.target);
  }

  async pickRoute(plan) {
    const local = await exec("ssh", probeArgs(plan.lan), { timeout: PROBE_MS }).catch(failed);
    return reachOf(local) === "ready" ? { name: plan.name, target: plan.lan, via: "", probe: false } : plan;
  }

  disconnect(key, machine, cx) {
    const record = machineRecord(machine);
    this.added = this.added.filter((m) => m.name !== machine.name);
    this.dropped = { ...this.dropped, [key]: { record, phase: "leaving" } };
    cx.notify();
    cx.spawn(async (cx) => {
      const error = hcError(await hc(rmArgs(machine.name)).catch(failed));
      if (error) {
        delete this.dropped[key];
        this.jobs[key] = { phase: "failed", reach: "failed", words: String(error.message ?? "").trim(), retry: (cx) => this.disconnect(key, machine, cx) };
        await this.refresh();
      } else {
        this.dropped = { ...this.dropped, [key]: { record, phase: "gone" } };
        run(`${SIDEBAR_REFRESH}${machine.name}`);
      }
      cx.notify();
    });
  }

  undo(key, cx) {
    const { record } = this.dropped[key];
    this.dropped = { ...this.dropped, [key]: { record, phase: "returning" } };
    cx.notify();
    cx.spawn(async (cx) => {
      const error = hcError(await hc(restoreArgs(record)).catch(failed));
      if (error) {
        this.dropped = { ...this.dropped, [key]: { record, phase: "gone" } };
        this.jobs[key] = { phase: "failed", reach: "failed", words: String(error.message ?? "").trim(), retry: (cx) => this.undo(key, cx) };
      } else {
        delete this.dropped[key];
        delete this.jobs[key];
        await this.refresh();
        run(`${SIDEBAR_REFRESH}${record.name}`);
      }
      cx.notify();
    });
  }

  setUp() {
    explainWith(this.explainer, { name: "Set up a computer", folder: home(), task: setupPrompt({ platform: this.platform }) });
    this.close();
  }

  fail(key, reach, words) {
    this.jobs[key] = { ...this.jobs[key], phase: "failed", reach, words };
  }

  async checkMac(name) {
    const machine = this.added.find((m) => m.name === name || m.target === name);
    if (!machine) return;
    const r = await tryOrAsync(() => exec("sh", ["-c", 'uname; command -v herdr-core || echo "$HOME/.local/bin/herdr-core"'], { on: machine.name, timeout: PROBE_MS }));
    const [os, core] = String(r?.stdout ?? "").trim().split("\n");
    if (os === "Darwin") this.macs[machine.name] = { core: core || "~/.local/bin/herdr-core" };
  }

  fix(key, job, cx) {
    const { reach, plan } = job;
    if (job.retry) {
      delete this.jobs[key];
      job.retry(cx);
      return;
    }
    if (reach === "password") {
      run("tab.new", { name: `Add ${plan.name || plan.target}`, argv: keySetup(plan, this.platform) });
      delete this.jobs[key];
      this.close();
      return;
    }
    if (reach === "hostkey" && job.choice.peer) {
      this.jobs[key] = { ...job, phase: "adding" };
      cx.spawn(async (cx) => {
        await tryOrAsync(() => exec("ssh-keygen", forgetArgs(job.choice.peer.ip), { timeout: PROBE_MS }));
        await this.connect(key, plan);
        cx.notify();
      });
      cx.notify();
      return;
    }
    this.add(key, job.choice, cx);
  }

  copy(text, cx) {
    cx.write_to_clipboard(text);
    this.copied = text;
    cx.notify();
  }

  commandLine(id, text, c) {
    return h_flex().w_full().gap(G.sm).items_center()
      .child(div().flex_1().min_w(0).child(code(id, c, { text })))
      .child(button(`${id}-copy`, this.copied === text ? "Copied" : "Copy", (cx) => this.copy(text, cx), c, { kind: "quiet", small: true }));
  }

  failure(key, job, c, about) {
    const said = advice(job.reach, about);
    return v_flex().w_full().gap(G.sm).pt(G.xs).pb(G.sm)
      .child(stateBlock(`computer-fail-${key}`, c, {
        text: said.text || `${about.name} wasn't added.`, source: job.words ?? "", fix: said.fix,
        onClick: (cx) => (said.url ? cx.open_url(said.url) : this.fix(key, job, cx)),
      }))
      .when(Boolean(said.command), (el) => el.child(this.commandLine(`computer-command-${key}`, said.command, c)));
  }

  noteBlock(c, text) {
    return v_flex().w_full().gap(G.sm).pb(G.sm).child(div().text_size(T.value).line_height(LH.body).text_color(c.muted).child(text));
  }

  macNote(name, c) {
    const mac = this.macs[name];
    return this.noteBlock(c, `${name} is a Mac. It asks on its own screen before an agent reads Desktop, Documents or Downloads, and waits for an answer. Give herdr-core Full Disk Access there once (press + and pick this file):`)
      .child(code(`computer-core-${name}`, c, { text: mac.core }))
      .child(h_flex().child(button(`computer-fda-${name}`, `Open the setting on ${name}`, () => { tryOrAsync(() => exec("open", [FDA_PANE], { on: name })); }, c, { kind: "tonal", small: true })));
  }

  lingerNote(machine, c) {
    const command = `sudo loginctl enable-linger -- ${machine.logout_linger_user ?? "<user>"}`;
    return this.noteBlock(c, `Agents on ${machine.name} stop when your last login there closes, as when this laptop sleeps. Run this on ${machine.name} once:`)
      .child(this.commandLine(`computer-linger-${machine.name}`, command, c));
  }

  undoFact(key) {
    const dropped = this.dropped[key];
    return dropped?.phase === "gone" && canRestore(dropped.record) ? [{ text: "Undo", label: "Undo", tip: "Add it back as it was", onClick: (cx) => this.undo(key, cx) }] : [];
  }

  rowState(key, { job, machine, choice, offline }) {
    const dropped = this.dropped[key];
    if (dropped && dropped.phase !== "gone") return { busy: true, meta: dropped.phase === "leaving" ? "Disconnecting…" : "Adding back…" };
    if (machine) return { action: { label: "Disconnect", onClick: (cx) => this.disconnect(key, machine, cx), kind: "quiet" } };
    const adding = job?.phase === "adding";
    const add = choice ? (cx) => this.add(key, choice, cx) : null;
    return {
      busy: adding,
      meta: adding ? "Connecting…" : offline ? "Offline" : dropped ? "Disconnected" : null,
      action: adding || offline || !add ? null : { label: job ? "Retry" : "Add", onClick: add, kind: "tonal" },
      onClick: adding || offline ? null : add,
    };
  }

  computer(c, { key, icon, name, facts = [], choice, done, offline = false, about, ip = "" }) {
    const job = this.jobs[key];
    const machine = done ? this.added.find((m) => isAdded([m], { name, target: choice?.target, ip })) : null;
    return v_flex().w_full()
      .child(row(`computer-${key}`, c, {
        icon, name, detail: [...facts.filter(Boolean), ...this.undoFact(key)], dimmed: offline, ...this.rowState(key, { job, machine, choice, offline }),
      }))
      .when(job?.phase === "failed", (el) => el.child(this.failure(key, job, c, about)))
      .when(Boolean(machine && this.macs[machine.name]), (el) => el.child(this.macNote(machine.name, c)))
      .when(machine?.keeps_running_after_logout === false, (el) => el.child(this.lingerNote(machine, c)));
  }

  heading(c, text) {
    return div().pt(G.lg).pb(G.xs).text_size(T.body).font_medium().text_color(c.dim).child(text);
  }

  note(c, text) {
    return div().py(G.xs).text_size(T.value).line_height(LH.body).text_color(c.muted).child(text);
  }

  tailnetSection(c) {
    if (this.net === undefined) return [this.heading(c, "Tailscale"), this.note(c, "Looking for your computers…")];
    if (this.net === null) return [this.heading(c, "Tailscale"), this.note(c, "Tailscale isn't on this computer. Where it is, your computers show up here by themselves.")];
    if (this.net.state !== "Running") return [this.heading(c, "Tailscale"), this.note(c, "Tailscale is off on this computer. Turn it on and your computers show up here.")];
    const peers = this.peers();
    if (!peers.length) return [this.heading(c, "Tailscale"), this.note(c, "No other computer is on your tailnet yet.")];
    return [this.heading(c, "On your tailnet"), ...peers.map((peer) => {
      const alias = this.aliasFor(peer);
      const lan = lanOf(peer, this.nearby ?? []);
      return this.computer(c, {
        key: peer.name, icon: osIcon(peer.os), name: peer.name, ip: peer.ip,
        facts: [osWord(peer.os), peer.ip, peer.tailscaleSsh ? "Tailscale SSH" : null, alias ? `ssh ${alias.alias}` : null, lan ? "On this network" : null],
        choice: { peer, target: "", name: peer.name, alias, lan },
        done: isAdded(this.added, { name: peer.name, ip: peer.ip, target: alias?.alias }), offline: !peer.online,
        about: { name: peer.name, os: peer.os, tailnet: true },
      });
    })];
  }

  aliasFor(peer) {
    return usesTailscaleSsh(peer, this.tailscale) ? null : aliasOf(peer, this.hosts);
  }

  shownHosts() {
    const folded = new Set(this.peers().map((peer) => this.aliasFor(peer)?.alias).filter(Boolean));
    return (this.hosts ?? []).filter((h) => !folded.has(h.alias));
  }

  nearbyHosts() {
    return nearbyOnly(this.nearby ?? [], { peers: this.peers(), hosts: this.hosts ?? [], added: [] });
  }

  addedSection(c) {
    const listed = (m) => this.peers().some((p) => isAdded([m], { name: p.name, ip: p.ip })) || this.shownHosts().some((h) => isAdded([m], { name: h.alias, target: h.alias }))
      || this.nearbyHosts().some((h) => isAdded([m], { name: h.name, ip: h.ip }));
    const gone = Object.entries(this.dropped).filter(([key]) => key.startsWith("added:")).map(([, { record }]) => record)
      .filter((record) => !this.added.some((m) => m.name === record.name));
    const others = [...this.added, ...gone].filter((m) => !listed(m));
    return others.length ? [this.heading(c, "Added"), ...others.map((m) => this.computer(c, {
      key: `added:${m.name}`, icon: "server", name: m.name, facts: [m.target || m.via || ""], choice: null, done: true, about: { name: m.name },
    }))] : [];
  }

  nearbySection(c) {
    if (this.nearby === null) return [];
    if (this.nearby === undefined) return [this.heading(c, "On this network"), this.note(c, "Looking for computers that answer ssh…")];
    const hosts = this.nearbyHosts();
    if (!hosts.length) return [this.heading(c, "On this network"), this.note(c, "No other computer on this network answers ssh.")];
    return [this.heading(c, "On this network"), ...hosts.map((h) => this.computer(c, {
      key: `lan:${h.ip}`, icon: osIcon(h.os), name: h.name || h.ip, ip: h.ip,
      facts: [h.os, h.name ? h.ip : null],
      choice: { peer: null, target: h.ip, name: h.name },
      done: isAdded(this.added, { ip: h.ip, name: h.name }),
      about: { name: h.name || h.ip, os: h.os },
    }))];
  }

  sshSection(c) {
    const hosts = this.shownHosts();
    if (!hosts.length) return [];
    return [this.heading(c, "From your ssh config"), ...hosts.map((h) => this.computer(c, {
      key: `ssh:${h.alias}`, icon: "server", name: h.alias,
      facts: [[h.user, h.hostname].filter(Boolean).join("@")],
      choice: { peer: null, target: h.alias, name: "" },
      done: isAdded(this.added, { name: h.alias, target: h.alias }),
      about: { name: h.alias },
    }))];
  }

  typedSection(c) {
    const key = this.typedKey();
    const job = key ? this.jobs[key] : null;
    return [this.heading(c, "Or type how ssh reaches it"),
      h_flex().w_full().gap(G.sm).items_center()
        .child(div().flex_1().min_w(0).child(field("computers-typed", this.typed, c, { spoken: "user@host" })))
        .child(button("computers-add-typed", job?.phase === "adding" ? "Connecting…" : "Add", (cx) => this.addTyped(cx), c, { disabled: !key || job?.phase === "adding" })),
      job?.phase === "failed" ? this.failure(key, job, c, { name: key }) : null];
  }

  render() {
    const c = tokens(theme());
    return dialog("kanso-computers", c, {
      title: "Add a computer", focusHandle: this.handle, secondary: "Close", onCancel: () => this.close(),
      primary: "Set up with an agent", kind: "tonal", state: this.explainer === undefined ? "disabled" : "default", onPrimary: () => this.setUp(),
      body: [
        div().text_size(T.value).line_height(LH.body).text_color(c.muted)
          .child("A Mac mini, a box at home, a VPS: its agents show in this sidebar and keep running while this laptop sleeps. Pick it and press Add."),
        v_flex().id("computers-list").w_full().max_h(DIALOG.computers).min_h(0).flex_shrink(1).mx(-G.sm).px(G.sm).overflow_y_scroll()
          .children([...this.tailnetSection(c), ...this.nearbySection(c), ...this.sshSection(c), ...this.addedSection(c)].filter(Boolean)),
        ...this.typedSection(c).filter(Boolean),
      ],
    });
  }
}
