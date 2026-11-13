// Check that importing approved drawings leaves the Storybook's guidelines as they are.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importApproved } from "../scripts/import-approved.mjs";

test("Importing the approved drawings keeps the guidelines written in the Storybook", () => {
  const root = mkdtempSync(join(tmpdir(), "kanso-approved-"));
  try {
    cpSync(new URL("../stories", import.meta.url), join(root, "stories"), { recursive: true });
    const before = JSON.parse(readFileSync(join(root, "stories/references.json"), "utf8"));
    const rows = before.boards.map((board) => `<tr><td class="no">${board.code}</td><td><span class="st st-ok"><i></i>Approved</span></td></tr>`).join("");
    const boards = before.boards.map((board) => `<section class="board" id="${board.anchor}"><div class="k k-dark"><div class="prow">One</div></div><aside class="notes">\n<p>An imported essay.</p>\n</aside></section>`).join("");
    const master = join(root, "master.html");
    writeFileSync(master, `<section class="board" id="control"><table>${rows}</table></section>${boards}`);
    importApproved(master, root);
    const after = JSON.parse(readFileSync(join(root, "stories/references.json"), "utf8"));
    assert.deepEqual(after.pages.map((page) => [page.page, page.guidelines]), before.pages.map((page) => [page.page, page.guidelines]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
