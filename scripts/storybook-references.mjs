// Generate named reference pages that reuse the component catalog.
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { statusOf } from "../stories/kit/status.js";

export const referenceSlug = (page) => page.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function generateReferences(root = ".", records = []) {
  let references;
  try { references = JSON.parse(readFileSync(join(root, "stories/references.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  const out = join(root, "stories/references");
  mkdirSync(out, { recursive: true });
  const expected = new Set(references.pages.filter((reference) => !reference.existing).map((reference) => `${referenceSlug(reference.page)}.mdx`));
  for (const name of readdirSync(out)) {
    if (!name.endsWith(".mdx") || expected.has(name)) continue;
    const path = join(out, name);
    if (readFileSync(path, "utf8").includes("import { ReferencePage } from '../kit/ReferencePage.jsx';")) unlinkSync(path);
  }
  for (const reference of references.pages) {
    if (reference.existing) continue;
    writeFileSync(join(out, `${referenceSlug(reference.page)}.mdx`), `import { Meta } from '@storybook/addon-docs/blocks';\nimport { ReferencePage } from '../kit/ReferencePage.jsx';\n\n<Meta title=${JSON.stringify(reference.page)} tags={[${JSON.stringify(statusOf(reference.page, records, references.pages))}]} />\n<ReferencePage page=${JSON.stringify(reference.page)} />\n`);
  }
  return references.pages.filter((reference) => !reference.existing).length;
}
