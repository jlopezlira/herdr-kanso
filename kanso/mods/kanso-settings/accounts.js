import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, setShared, checking } from "herdr";
import { G, T } from "./ui.js";
import { button } from "./ui-button.js";
import { field, TextField } from "./ui-field.js";
import { stateBlock } from "./ui-state.js";
import { section } from "./ui-section.js";
import { localSecrets } from "./platform-secrets.js";
import { JIRA, jiraClient, siteOf } from "./issues-jira.js";
import { LINEAR, LINEAR_ACCOUNT, linearClient } from "./issues-linear.js";
import { ACCOUNTS } from "./issues-model.js";

const NO_STORE = "This computer has no secret store, so Jira and Linear can't sign in here. GitHub keeps working.";
const NO_DIALOG = "This computer can't show a secure dialog for the token, so Jira and Linear can't sign in here. GitHub keeps working.";
const CANCELLED = "No token was saved";
const KEPT = "The secret store kept the token, so you are still signed in";
const STUCK = "The secret store kept the token; remove it there or sign in again";

const kept = () => {
  const value = shared(ACCOUNTS);
  return value && typeof value === "object" ? value : {};
};
const without = (key) => Object.fromEntries(Object.entries(kept()).filter(([k]) => k !== key));

const SERVICES = {
  jira: { service: JIRA, account: (state) => state.site, label: (state) => `kansō Jira ${state.site}`, words: (state) => `Paste your Jira API token for ${state.site}` },
  linear: { service: LINEAR, account: () => LINEAR_ACCOUNT, label: () => "kansō Linear", words: () => "Paste your Linear personal API key" },
};

export class Accounts {
  constructor(cx) {
    this.secrets = localSecrets();
    this.available = null;
    this.busy = null;
    this.errors = {};
    this.site = new TextField({ placeholder: "your-site.atlassian.net", value: kept().jira?.site ?? "" });
    this.email = new TextField({ placeholder: "you@example.com", value: kept().jira?.email ?? "" });
    for (const text of [this.site, this.email]) text.on("change", (_e, next) => next.notify());
    if (!checking()) cx.spawn(async (next) => { this.available = (await this.secrets.available()) && ((await this.secrets.canAsk()) || "no dialog"); next.notify(); });
  }

  fail(key, text, cx) { this.errors = { ...this.errors, [key]: text }; this.busy = null; cx.notify(); }

  start(kind, cx) { this.busy = kind; this.errors = { ...this.errors, [kind]: null }; cx.notify(); }

  signIn(kind, state, check, keep, cx) {
    this.start(kind, cx);
    cx.spawn(async (next) => {
      const s = SERVICES[kind];
      const asked = await this.secrets.ask(s.service, s.account(state), s.label(state), s.words(state));
      if (asked === "cancelled") { this.fail(kind, CANCELLED, next); return; }
      if (asked !== "saved") { this.fail(kind, "The secret store could not ask for the token", next); return; }
      const me = await check();
      if (me.failure) {
        const forgotten = await this.forget(kind, state);
        this.fail(kind, forgotten ? `${me.failure.text}. The token was not kept` : `${me.failure.text}. ${STUCK}`, next);
        return;
      }
      setShared(ACCOUNTS, { ...kept(), [kind]: keep(me) });
      this.busy = null;
      next.notify();
    });
  }

  signInJira(cx) {
    const site = siteOf(this.site.value()), email = this.email.value().trim();
    if (!site) { this.fail("jira", "Enter your Jira Cloud site, such as your-site.atlassian.net", cx); return; }
    if (!email) { this.fail("jira", "Enter the email you sign in to Jira with", cx); return; }
    this.signIn("jira", { site }, () => jiraClient(this.secrets, { site, email }).me(), (me) => ({ site, email, name: me.name, accountId: me.accountId }), cx);
  }

  signInLinear(cx) {
    this.signIn("linear", {}, () => linearClient(this.secrets).me(), (me) => ({ name: me.name, email: me.email, id: me.id }), cx);
  }

  async forget(kind, state) {
    const s = SERVICES[kind], account = s.account(state);
    await this.secrets.remove(s.service, account);
    return this.secrets.gone(s.service, account);
  }

  signOut(kind, cx) {
    this.start(kind, cx);
    cx.spawn(async (next) => {
      if (!(await this.forget(kind, kept()[kind] ?? {}))) { this.fail(kind, KEPT, next); return; }
      setShared(ACCOUNTS, without(kind));
      this.busy = null;
      next.notify();
    });
  }

  connected(id, c, words, kind) {
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().gap(G.md).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(c.text).child(words))
        .child(button(`${id}-out`, this.busy === kind ? "Signing out…" : "Sign out", (cx) => this.signOut(kind, cx), c, { disabled: Boolean(this.busy) })))
      .children([this.error(kind, c)].filter(Boolean));
  }

  error(kind, c) {
    return this.errors[kind] ? stateBlock(`accounts-${kind}-error`, c, { text: this.errors[kind] }) : null;
  }

  signInButton(id, kind, words, onClick, c) {
    return h_flex().child(button(id, this.busy === kind ? "Waiting for the secret store…" : words, onClick, c, { disabled: Boolean(this.busy) }));
  }

  jira(c) {
    const jira = kept().jira;
    if (jira?.name) return this.connected("accounts-jira", c, `Connected as ${jira.name} · ${jira.site}`, "jira");
    return v_flex().w_full().gap(G.sm)
      .child(field("accounts-jira-site", this.site, c, { label: "Site" }))
      .child(field("accounts-jira-email", this.email, c, { label: "Email" }))
      .children([this.error("jira", c)].filter(Boolean))
      .child(this.signInButton("accounts-jira-in", "jira", "Sign in to Jira", (cx) => this.signInJira(cx), c));
  }

  linear(c) {
    const linear = kept().linear;
    if (linear?.name) return this.connected("accounts-linear", c, `Connected as ${linear.name}`, "linear");
    return v_flex().w_full().gap(G.sm)
      .children([this.error("linear", c)].filter(Boolean))
      .child(this.signInButton("accounts-linear-in", "linear", "Sign in to Linear", (cx) => this.signInLinear(cx), c));
  }

  page(c) {
    if (this.available === null) return stateBlock("accounts-checking", c, { text: "Looking for this computer's secret store…" });
    if (this.available !== true) return stateBlock("accounts-none", c, { text: this.available ? NO_DIALOG : NO_STORE });
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().w_full().gap(G.sm).child(section(c, "Jira")).child(div().text_size(T.body).text_color(c.dim)
        .child("Your API token goes straight into this computer's secret store. kansō never sees or keeps it.")).child(this.jira(c)))
      .child(v_flex().w_full().gap(G.sm).child(section(c, "Linear")).child(this.linear(c)));
  }
}
