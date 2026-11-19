#!/usr/bin/env node
// Usage: npm run build:issue-forms [-- --check]
// Writes the Bug and Work item issue forms from one set of fields; --check fails when one differs.
import { readFileSync, writeFileSync } from "node:fs";
import { CHECK, isMain, ROOT_URL as ROOT } from "./cli.mjs";

const FOLDER = ".github/ISSUE_TEMPLATE/";
const CI_GREEN = "CI is green on macOS, Windows and Linux";

// One form field; `required` marks the field, `checked` every checkbox.
const field = (type, id, label, { description, placeholder, options, required = false, checked = false } = {}) => ({ type, id, label, description, placeholder, options, required, checked });
const testCases = (description, required) => field("textarea", "test-cases", "Test cases", { description, required });
const done = (options, checked) => field("checkboxes", "done", "Definition of Done", { options, checked });

const FORMS = {
  "bug_report.yml": {
    name: "Bug", description: "Something does not work the way kansō says it does.", labels: "bug",
    body: [
      field("input", "kanso-version", "kansō version", { description: "The version kansō shows, or the version in kanso/mods/kanso-chrome/version.json.", placeholder: "3.29.0", required: true }),
      field("input", "herdr-version", "Herdr version", { required: true }),
      field("dropdown", "os", "OS", { options: ["macOS", "Windows", "Linux"], required: true }),
      field("dropdown", "remote-space", "Is the space on another computer?", { options: ["Yes", "No"], required: true }),
      field("textarea", "steps", "Steps to reproduce", { description: "Numbered steps, starting from a fresh state.", placeholder: ["1.", "2.", "3."], required: true }),
      field("textarea", "expected", "What you expected", { required: true }),
      field("textarea", "saw", "What you saw", { description: "One or two sentences. What you saw, not what you think the cause is.", required: true }),
      field("textarea", "more", "Anything else", { description: "A screenshot or the last lines of an error. Remove anything private first." }),
      testCases("One line per case: given, when, then.", true),
      field("checkboxes", "acceptance", "Acceptance criteria", { checked: true, options: [
        "The steps above no longer reproduce the problem",
        "A regression test covers it and fails on the old code",
        "Nothing the module offered before stops working",
      ] }),
      done(["The pull request shows each acceptance criterion met", CI_GREEN, "CHANGELOG has a Fixed entry under Unreleased", "Verified in the running app on the beta"], false),
    ],
  },
  "work_item.yml": {
    name: "Work item", description: "A change we plan: design, scope, acceptance criteria, ready and done.", labels: "enhancement",
    body: [
      field("textarea", "problem", "Problem", { required: true }),
      field("textarea", "scope", "Scope", { description: "What changes and which modules.", required: true }),
      field("textarea", "out-of-scope", "Out of scope"),
      field("input", "design", "Design", { description: "The design that defines it.", required: true }),
      field("textarea", "acceptance", "Acceptance criteria", { description: "One per line, each observable and testable: given, when, then.", required: true }),
      testCases("The tests that prove each criterion; name the file when it exists.", false),
      field("checkboxes", "ready", "Definition of Ready", { checked: true, options: [
        "The design is approved and named above",
        "The modules to change are named",
        "Every feature the modules offer today is listed, so none is lost",
        "Each acceptance criterion is testable",
        "Out of scope is stated",
      ] }),
      done([
        "Every acceptance criterion is met, with evidence in the pull request",
        "Every listed feature still works and the pull request shows it",
        "The screen matches the design in both themes",
        "Tests cover the change and npm test passes",
        CI_GREEN,
        "CHANGELOG entry under Unreleased",
        "Merged to develop and verified in the running app on the beta",
      ], true),
    ],
  },
};

// A YAML scalar, quoted where YAML would read it as something else.
const scalar = (text) => (/[:;]|^(?:Yes|No)$/.test(text) ? JSON.stringify(text) : text);

const fieldLines = ({ type, id, label, description, placeholder, options, required, checked }) => [
  `  - type: ${type}`,
  `    id: ${id}`,
  "    attributes:",
  `      label: ${scalar(label)}`,
  ...(description ? [`      description: ${scalar(description)}`] : []),
  ...(typeof placeholder === "string" ? [`      placeholder: ${placeholder}`] : []),
  ...(Array.isArray(placeholder) ? ["      placeholder: |", ...placeholder.map((line) => `        ${line}`)] : []),
  ...(options ? ["      options:"] : []),
  ...(options ?? []).flatMap((option) => (type === "checkboxes"
    ? [`        - label: ${scalar(option)}`, ...(checked ? ["          required: true"] : [])]
    : [`        - ${scalar(option)}`])),
  ...(required ? ["    validations:", "      required: true"] : []),
];

export const render = ({ name, description, labels, body }) => [
  "# Generated from scripts/build-issue-forms.mjs by npm run build:issue-forms.",
  `name: ${name}`,
  `description: ${scalar(description)}`,
  `labels: ["${labels}"]`,
  "body:",
  ...body.flatMap(fieldLines),
  "",
].join("\n");

export const BUILT_FORMS = Object.keys(FORMS).map((file) => `${FOLDER}${file}`);

if (isMain(import.meta.url)) {
  const stale = Object.entries(FORMS).filter(([file, form]) => readFileSync(new URL(`${FOLDER}${file}`, ROOT), "utf8") !== render(form));
  if (CHECK && stale.length) {
    console.error(`${stale.map(([file]) => `${FOLDER}${file}`).join(", ")} differ from scripts/build-issue-forms.mjs: run npm run build:issue-forms`);
    process.exit(1);
  }
  if (!CHECK) for (const [file, form] of stale) writeFileSync(new URL(`${FOLDER}${file}`, ROOT), render(form));
  console.log(CHECK ? "issue forms match their source" : `wrote ${stale.length} issue forms`);
}
