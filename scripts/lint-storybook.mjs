import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SECTIONS, expand } from './storybook-catalog.mjs';
import { explainErrors } from './storybook-components.mjs';
import { gapDocument, overlapFor } from './storybook-coverage.mjs';
import { descriptions } from '../stories/kit/descriptions.js';
import references from "../stories/references.json" with { type: "json" };

const STORY_FILE = /\.stories\.(?:js|jsx|mjs|ts|tsx)$/;

export function storyFiles(root = 'stories') {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((file) => file.isFile() && (STORY_FILE.test(file.name) || /\.(mdx|json)$/.test(file.name))).map((file) => {
    const path = join(file.parentPath, file.name).replaceAll('\\', '/');
    return [path, readFileSync(path, 'utf8')];
  }));
}

export function structureErrors(files, catalog, template) {
  const errors = [], titles = new Map(), docs = new Set();
  const statePage = /(?:^|[ ,])(?:hover|focus|active|disabled|dimmed|loading|empty|failure|armed|pending|working|at rest|tab states)(?:$|[ ,])/i;
  const titleOf = (path, title) => {
    if (!SECTIONS.includes(title.split('/')[0]) || title.split('/').length !== 2) errors.push(`${path}: story outside the six sections`);
    if (statePage.test(title.split('/')[1] ?? '') && !references.pages.some((reference) => reference.page === title && reference.boards.length)) errors.push(`${path}: state page instead of component`);
    if (titles.has(title)) errors.push(`${path}: duplicate title ${title}`);
    titles.set(title, path);
  };
  for (const [path, text] of Object.entries(files).filter(([path]) => STORY_FILE.test(path))) {
    const title = /export default\s*\{\s*title:\s*"([^"]+)"/.exec(text)?.[1];
    if (!title) { errors.push(`${path}: missing component title`); continue; }
    titleOf(path, title);
    if (!descriptions[title.split('/')[1]]) errors.push(`${path}: missing component usage`);
    if (!/export const Variants = componentStory\("[^"]+"\);/.test(text) || /(?:html|render)\s*[:=][\s\S]*["'`]</.test(text)) errors.push(`${path}: repeated story markup outside the shared catalog`);
    if (!text.includes(`componentStory(${JSON.stringify(title)})`)) errors.push(`${path}: preview references another page`);
    const firstName = /name:\s*["']([^"']+)/.exec(text)?.[1] ?? (/export const (\w+)/.exec(text)?.[1]);
    if (firstName === title.split('/')[1]) errors.push(`${path}: docs and first story repeat a title`);
  }
  for (const [path, text] of Object.entries(files).filter(([path]) => path.endsWith('.mdx'))) {
    const explicit = /<Meta title="([^"]+)"/.exec(text)?.[1];
    if (explicit) {
      titleOf(path, explicit);
      const named = /<ReferencePage page="([^"]+)" \/>/.exec(text)?.[1];
      if (named) {
        if (named !== explicit || !references.pages.some((reference) => reference.page === named && (!reference.existing || named.startsWith("Start/")))) errors.push(`${path}: unregistered named reference`);
        docs.add(explicit);
      } else if (!/## Prompt for agents\s+```text\s+\S/.test(text)) errors.push(`${path}: missing prompt block`);
    } else {
      const target = /import \* as stories from '\.\/([^']+)'/.exec(text)?.[1];
      const title = /page="([^"]+)"/.exec(text)?.[1];
      const storyPath = posix.join(path.slice(0, path.lastIndexOf('/')), target ?? '');
      if (!target || titles.get(title) !== storyPath) errors.push(`${path}: unattached component docs`);
      if (!/<Meta of=\{stories\} name="Overview" \/>/.test(text) || !/<ComponentPage of=\{stories\} page="[^"]+" \/>/.test(text) || !/<h2>Prompt for agents<\/h2>/.test(template) || !template.includes('Copy prompt')) errors.push(`${path}: missing prompt block`);
      docs.add(title);
    }
  }
  for (const [title, path] of titles) if (!title.startsWith('Start/') && !docs.has(title)) errors.push(`${path}: missing component page and prompt block`);
  const parts = new Set();
  for (const part of catalog.parts) {
    const key = JSON.stringify(part);
    if (parts.has(key)) errors.push('catalog: repeated story markup or documentation');
    parts.add(key);
  }
  for (const [path, text] of Object.entries(files).filter(([path]) => path.endsWith('.json') && !path.endsWith('/catalog.json'))) {
    if (/<[a-z]/i.test(text)) errors.push(`${path}: repeated story markup outside the shared catalog`);
  }
  const ids = new Set();
  const records = expand(catalog), byId = new Map(records.map((record) => [record.id, record]));
  if (records.some((record) => record.gap) && (!template.includes('<h3>{FEATURE_LABEL}</h3>') || template.indexOf('<h3>{FEATURE_LABEL}</h3>') < template.indexOf('<Source code={prompt}'))) errors.push('component page: missing plain feature list under Prompt for agents');
  for (const record of records) {
    if (ids.has(record.id)) errors.push(`catalog: duplicate state ${record.id}`);
    ids.add(record.id);
    if (record.html !== undefined) for (const error of explainErrors(record.html)) errors.push(`${record.id}: ${error}`);
    if (overlapFor(record) && (record.html !== undefined || (!record.design && !record.gap))) errors.push(`${record.id}: overlapping coverage must reference its design or list the feature to redesign`);
    if (record.design && (!byId.get(record.design)?.html || byId.get(record.design).page !== record.page || byId.get(record.design).source === 'coverage')) errors.push(`${record.id}: missing designed drawing`);
    if ((record.design || record.gap) && (record.html !== undefined || !/^[\w./-]+:\d+(?:-\d+)?$/.test(record.location ?? ''))) errors.push(`${record.id}: feature must have a source location and no independent drawing`);
    if (!docs.has(record.page)) errors.push(`catalog: unreachable state ${record.id}`);
    if (/\b(?:prototypes?|boards?|designers?|agents?|subtracted|removed)\b/i.test([record.caption, record.context ?? '', record.label, ...(record.notes ?? []), ...(record.spec ?? []).flat()].join(' '))) errors.push(`catalog: source reference or outdated feature wording in ${record.id}`);
  }
  return errors;
}

export function lint(root = '.') {
  const catalog = JSON.parse(readFileSync(join(root, 'stories/catalog.json'), 'utf8'));
  const errors = structureErrors(storyFiles(join(root, 'stories')), catalog, readFileSync(join(root, 'stories/kit/ComponentPage.jsx'), 'utf8'));
  if (readFileSync(join(root, 'stories/GAPS.md'), 'utf8') !== gapDocument(expand(catalog))) errors.push('GAPS.md: feature inventory differs from component pages');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = lint();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Storybook structure passed');
}
