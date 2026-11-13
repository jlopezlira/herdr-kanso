import { readFileSync, writeFileSync } from 'node:fs';
import { descriptions } from '../stories/kit/descriptions.js';
import { content, featuresFor, statesFor } from '../stories/kit/catalog.js';
import { promptFor } from '../stories/kit/prompt.js';
import { FEATURE_LABEL, FEATURE_NOTE } from '../stories/kit/features.js';
import { referenceFor, referenceStates, statusFor } from "../stories/kit/references.js";

const file = 'storybook-static/manifests/docs.json';
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const index = JSON.parse(readFileSync('storybook-static/index.json', 'utf8'));
for (const entry of Object.values(index.entries).filter((entry) => entry.type === 'docs' && !entry.title.startsWith('Start/'))) {
  const doc = { id: entry.id, name: entry.name, path: entry.importPath, title: entry.title };
  manifest.docs[doc.id] = doc;
  const reference = referenceFor(doc.title);
  if (reference && !reference.existing) {
    doc.content = [
      `# ${doc.title.split("/")[1]}`, `Status: ${statusFor(doc.title)}`,
      ...reference.guidelines, "## States", reference.approvedRecords?.length ? "Approved reference drawings; additional states are Proposed." : "Proposed",
      ...(reference.proposedPredicates ?? []).map((predicate) => `Proposed: ${predicate.label} (${predicate.location})`),
      ...referenceStates(doc.title).flatMap((state) => [`### ${reference.approvedRecords?.includes(state.id) ? "" : "Proposed: "}${state.label}`, content(state.caption)]),
      "## Components", ...reference.components,
      "## Prompt for agents", `Build ${doc.title} from the shared kit. Preserve every action and apply the guidelines above.`,
    ].join("\n\n");
    continue;
  }
  const states = statesFor(doc.title);
  const description = descriptions[doc.title.split('/')[1]];
  const contexts = [...new Set([...states, ...featuresFor(doc.title)].flatMap((state) => state.context === undefined ? [] : [state.context]))].map(content);
  const notes = [...new Set(states.flatMap((state) => state.notes ?? []))].map(content);
  doc.content = [
    `# ${doc.title.split('/')[1]}`, `Status: ${statusFor(doc.title)}`, description, ...(contexts.length ? ['## Usage details', ...contexts] : []), '## States',
    ...states.flatMap((state) => [`### ${state.label}`, content(state.caption), ...(state.location ? [`Source: ${state.location}`] : []), ...(state.spec ?? []).map(([label, value]) => `- **${content(label)}**: ${content(value)}`), ...state.coverage.map((feature) => `- ${feature.label}: ${content(feature.caption)} (${feature.location})`)]),
    ...(notes.length ? ['## Guidelines', ...notes] : []), '## Prompt for agents', '```text\n' + promptFor(doc.title, states) + '\n```',
    ...(featuresFor(doc.title).some((feature) => feature.gap) ? [`### ${FEATURE_LABEL}`, FEATURE_NOTE, ...featuresFor(doc.title).filter((feature) => feature.gap).map((feature) => `- ${feature.label}: ${content(feature.caption)} (${feature.location})`)] : []),
  ].join('\n\n');
}
for (const doc of Object.values(manifest.docs).filter((doc) => doc.title?.startsWith('Start/') && doc.content)) {
  const status = `Status: ${statusFor(doc.title)}`;
  doc.content = /<PageStatus page="[^"]+" \/>/.test(doc.content) ? doc.content.replace(/<PageStatus page="[^"]+" \/>/, status) : doc.content.replace(/(<Meta [^>]*\/>)/, `$1\n\n${status}`);
}
writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(manifest.docs).length} documentation pages exported with usage, states and prompts`);
