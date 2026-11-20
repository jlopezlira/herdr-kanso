// What a toast says from the notification it is given, as the kit toast's props, and the command a click runs.

// A home's icon takes the state's colour on a success or a warning; on anything else it is a fact, muted.
const STATED = ["success", "warning"];
const FACT = "muted";

/** The kit toast's props: a failure is always the blocked mark; the fix word rides in the action's args; the detail, else the sentence for when its one line is cut, is the tooltip. */
export const toastOf = ({ level = "info", icon, title = "", body, action } = {}) => ({
  level, title, icon: icon || "none", action: action?.args?.label ?? null, detail: body || title,
  ...(level === "error" ? { mark: "blocked" } : {}),
  ...(icon && !STATED.includes(level) ? { tone: FACT } : {}),
});

/** The action's command and its args without the fix word, or null without one. */
export const commandOf = ({ action } = {}) => {
  if (!action?.name) return null;
  return { name: action.name, args: Object.fromEntries(Object.entries(action.args ?? {}).filter(([key]) => key !== "label")) };
};
