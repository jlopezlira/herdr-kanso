import { readFileSync, writeFileSync } from 'node:fs';
import { descriptions } from '../stories/kit/descriptions.js';
import { content, featuresFor, statesFor } from '../stories/kit/catalog.js';
import { promptFor } from '../stories/kit/prompt.js';
import { rules } from '../stories/kit/rules.js';
import { FEATURE_LABEL, FEATURE_NOTE } from '../stories/kit/features.js';
import { guidelines, prompts, sections } from '../stories/kit/guidelines.js';
import { statusOf } from "../stories/kit/status.js";

const file = 'storybook-static/manifests/docs.json';
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const index = JSON.parse(readFileSync('storybook-static/index.json', 'utf8'));
for (const entry of Object.values(index.entries).filter((entry) => entry.type === 'docs' && (!entry.title.startsWith('Start/') || prompts[entry.title]))) {
  const doc = { id: entry.id, name: entry.name, path: entry.importPath, title: entry.title };
  manifest.docs[doc.id] = doc;
  if (prompts[doc.title]) {
    doc.content = [`# ${doc.title.split("/").at(-1)}`, "## Prompt for agents", "```text\n" + prompts[doc.title] + "\n```"].join("\n\n");
    continue;
  }
  const states = statesFor(doc.title);
  const description = descriptions[doc.title.split('/').at(-1)];
  const contexts = [...new Set([...states, ...featuresFor(doc.title)].flatMap((state) => state.context === undefined ? [] : [state.context]))].map(content);
  const notes = [...new Set(states.flatMap((state) => state.notes ?? []))].map(content);
  doc.content = [
    `# ${doc.title.split('/').at(-1)}`, `Status: ${statusOf(doc.title)}`, description, ...(contexts.length ? ['## Usage details', ...contexts] : []), '## States',
    ...states.flatMap((state) => [`### ${state.label}`, content(state.caption), ...(state.location ? [`Source: ${state.location}`] : []), ...(state.spec ?? []).map(([label, value]) => `- **${content(label)}**: ${content(value)}`), ...state.coverage.map((feature) => `- ${feature.label}: ${content(feature.caption)} (${feature.location})`)]),
    ...(sections[doc.title] ?? []).flatMap(([title, text]) => [`## ${title}`, text]),
    ...(guidelines[doc.title] ? ['## Design guidelines', ...guidelines[doc.title].map(([principle, rule, detail]) => `- ${principle} **${rule}** ${detail}`)] : []),
    ...(notes.length || rules[doc.title] ? ['## Guidelines', ...notes, ...(rules[doc.title] ?? []).map((rule) => `- ${rule}`)] : []), '## Prompt for agents', '```text\n' + promptFor(doc.title, states) + '\n```',
    ...(featuresFor(doc.title).some((feature) => feature.gap) ? [`### ${FEATURE_LABEL}`, FEATURE_NOTE, ...featuresFor(doc.title).filter((feature) => feature.gap).map((feature) => `- ${feature.label}: ${content(feature.caption)} (${feature.location})`)] : []),
  ].join('\n\n');
}
writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(manifest.docs).length} documentation pages exported with usage, states and prompts`);
