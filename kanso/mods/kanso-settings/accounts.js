import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, shared, setShared, window } from "herdr";
import { G, T } from "./ui.js";
import { button } from "./ui-button.js";
import { field, TextField } from "./ui-field.js";
import { stateBlock } from "./ui-state.js";
import { section } from "./ui-section.js";
import { secretsApi } from "./platform-secrets.js";
import { JIRA, jiraClient, siteOf } from "./issues-jira.js";
import { LINEAR, LINEAR_ACCOUNT, linearClient } from "./issues-linear.js";
import { ACCOUNTS } from "./issues-model.js";

const run = (cmd, args) => exec(cmd, args).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
const kept = () => {
  const value = shared(ACCOUNTS);
  return value && typeof value === "object" ? value : {};
};
const without = (key) => Object.fromEntries(Object.entries(kept()).filter(([k]) => k !== key));
const masked = (placeholder) => {
  const text = new TextField({ placeholder });
  text.state.set_masked(true);
  return text;
};

export class Accounts {
  constructor(cx) {
    this.secrets = secretsApi(window()?.platform ?? "macos", run);
    this.available = null;
    this.busy = null;
    this.errors = {};
    this.site = new TextField({ placeholder: "your-site.atlassian.net", value: kept().jira?.site ?? "" });
    this.email = new TextField({ placeholder: "you@example.com", value: kept().jira?.email ?? "" });
    this.jiraToken = masked("API token");
    this.linearKey = masked("Personal API key");
    for (const text of [this.site, this.email, this.jiraToken, this.linearKey]) text.on("change", (_e, next) => next.notify());
    cx.spawn(async (next) => { this.available = await this.secrets.available().catch(() => false); next.notify(); });
  }

  fail(key, text, cx) { this.errors = { ...this.errors, [key]: text }; this.busy = null; cx.notify(); }

  signInJira(cx) {
    const site = siteOf(this.site.value()), email = this.email.value().trim(), token = this.jiraToken.value();
    if (!site) { this.fail("jira", "Enter your Jira Cloud site, such as your-site.atlassian.net", cx); return; }
    if (!email || !token) { this.fail("jira", "Enter your email and an API token", cx); return; }
    this.busy = "jira"; this.errors = { ...this.errors, jira: null }; cx.notify();
    cx.spawn(async (next) => {
      const saved = await this.secrets.save(JIRA, site, token);
      if (saved?.code !== 0) { this.fail("jira", "The secret store refused the token", next); return; }
      this.jiraToken.state.set_value("");
      const me = await jiraClient(this.secrets, { site, email }).me();
      if (me.failure) { await this.secrets.remove(JIRA, site); this.fail("jira", me.failure.text, next); return; }
      setShared(ACCOUNTS, { ...kept(), jira: { site, email, name: me.name } });
      this.busy = null; next.notify();
    });
  }

  signInLinear(cx) {
    const key = this.linearKey.value().trim();
    if (!key) { this.fail("linear", "Enter a personal API key", cx); return; }
    this.busy = "linear"; this.errors = { ...this.errors, linear: null }; cx.notify();
    cx.spawn(async (next) => {
      const saved = await this.secrets.save(LINEAR, LINEAR_ACCOUNT, key);
      if (saved?.code !== 0) { this.fail("linear", "The secret store refused the key", next); return; }
      this.linearKey.state.set_value("");
      const me = await linearClient(this.secrets).me();
      if (me.failure) { await this.secrets.remove(LINEAR, LINEAR_ACCOUNT); this.fail("linear", me.failure.text, next); return; }
      setShared(ACCOUNTS, { ...kept(), linear: { name: me.name, email: me.email } });
      this.busy = null; next.notify();
    });
  }

  signOut(kind, cx) {
    const account = kind === "jira" ? kept().jira?.site : LINEAR_ACCOUNT;
    cx.spawn(async (next) => {
      if (account) await this.secrets.remove(kind === "jira" ? JIRA : LINEAR, account);
      setShared(ACCOUNTS, without(kind));
      next.notify();
    });
  }

  connected(id, c, words, kind) {
    return h_flex().w_full().gap(G.md).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(c.text).child(words))
      .child(button(`${id}-out`, "Sign out", (cx) => this.signOut(kind, cx), c));
  }

  error(kind, c) {
    return this.errors[kind] ? stateBlock(`accounts-${kind}-error`, c, { text: this.errors[kind] }) : null;
  }

  jira(c) {
    const jira = kept().jira;
    if (jira?.name) return this.connected("accounts-jira", c, `Connected as ${jira.name} · ${jira.site}`, "jira");
    return v_flex().w_full().gap(G.sm)
      .child(field("accounts-jira-site", this.site, c, { label: "Site" }))
      .child(field("accounts-jira-email", this.email, c, { label: "Email" }))
      .child(field("accounts-jira-token", this.jiraToken, c, { label: "API token" }))
      .children([this.error("jira", c)].filter(Boolean))
      .child(h_flex().child(button("accounts-jira-in", this.busy === "jira" ? "Signing in…" : "Sign in to Jira", (cx) => this.signInJira(cx), c, { disabled: Boolean(this.busy) })));
  }

  linear(c) {
    const linear = kept().linear;
    if (linear?.name) return this.connected("accounts-linear", c, `Connected as ${linear.name}`, "linear");
    return v_flex().w_full().gap(G.sm)
      .child(field("accounts-linear-key", this.linearKey, c, { label: "API key" }))
      .children([this.error("linear", c)].filter(Boolean))
      .child(h_flex().child(button("accounts-linear-in", this.busy === "linear" ? "Signing in…" : "Sign in to Linear", (cx) => this.signInLinear(cx), c, { disabled: Boolean(this.busy) })));
  }

  page(c) {
    if (this.available === false) {
      return stateBlock("accounts-none", c, { text: "This computer has no secret store, so Jira and Linear can't sign in here. GitHub keeps working." });
    }
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().w_full().gap(G.sm).child(section(c, "Jira")).child(this.jira(c)))
      .child(v_flex().w_full().gap(G.sm).child(section(c, "Linear")).child(this.linear(c)));
  }
}
