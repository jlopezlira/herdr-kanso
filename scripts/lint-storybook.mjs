import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { posix } from 'node:path';
import { SECTIONS, expand } from './storybook-catalog.mjs';
import { explainErrors } from './storybook-components.mjs';
import { markupElements } from './storybook-markup.mjs';
import { gapDocument, overlapFor } from './storybook-coverage.mjs';
import { STORYBOOK_CLASSES, cssSelectors, markupClasses, selectorClasses } from './import-proto.mjs';
import { descriptions } from '../stories/kit/descriptions.js';
import { STATUSES, statusTags } from '../stories/kit/status.js';
import { isMain } from './cli.mjs';

const STORY_FILE = /\.stories\.(?:js|jsx|mjs|ts|tsx)$/;
const BEM = /^kanso-[a-z0-9]+(?:-[a-z0-9]+)*(__[a-z0-9-]+)?(--[a-z0-9-]+)?$/;
const CODE = /\b(?:[SBPQDI]\d{1,2}[a-e]?)\b|proto\/|approved-/;
// Report mode for the node count only: primitive violations are listed in stories/PRIMITIVES-TODO.md (`--todo` rewrites it); true once it lists none. Raw values always fail.
export const PRIMITIVES_ENFORCED = false;
const PRIMITIVES_TODO = 'stories/PRIMITIVES-TODO.md';
const RAW_VALUES = 'scripts/storybook-raw-values.json';
const RAW_CSS = ['stories/primitives.css', 'stories/compositions.css', 'stories/proto.css', 'stories/frame.css'];
const RAW_CODE = ['stories/kit', 'stories/components', 'stories/start'];
const RAW = /(?<![\w&.#-])(?:-?\d*\.?\d+px\b|#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\()/i;
const INLINE = /\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|\{\{[^}]*\}\})|\.style\.\w+\s*=/g;
const FRAME = /^kanso-(?:story|docs)(?:__|--|$)/;
const SWATCH = /^kanso-(?:tokens(?:__|--|$)|icon__)/;

export function storyFiles(root = 'stories') {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((file) => file.isFile() && (STORY_FILE.test(file.name) || /\.(mdx|json)$/.test(file.name))).map((file) => {
    const path = join(file.parentPath, file.name).replaceAll('\\', '/');
    return [path, readFileSync(path, 'utf8')];
  }));
}

export function structureErrors(files, catalog, template) {
  const errors = [], titles = new Map(), docs = new Set();
  const records = expand(catalog);
  const statusErrors = (path, title, tags) => {
    const found = (tags ?? '').match(/"[^"]*"/g)?.map((tag) => JSON.parse(tag)).filter((tag) => STATUSES.includes(tag)) ?? [];
    const wanted = statusTags(title);
    if (wanted.length && found.length !== 1) errors.push(`${path}: needs exactly one status tag`);
    else if (found.join() !== wanted.join()) errors.push(`${path}: status ${found.join() || "none"} differs from ${wanted.join() || "none"}`);
  };
  const statePage = /(?:^|[ ,])(?:hover|focus|active|disabled|dimmed|loading|empty|failure|armed|pending|working|at rest|tab states)(?:$|[ ,])/i;
  const titleOf = (path, title) => {
    if (!SECTIONS.includes(title.split('/')[0]) || ![2, 3].includes(title.split('/').length)) errors.push(`${path}: story outside the sections`);
    if (CODE.test(title)) errors.push(`${path}: code in title ${title}`);
    if (statePage.test(title.split('/').at(-1) ?? '')) errors.push(`${path}: state page instead of component`);
    if (titles.has(title)) errors.push(`${path}: duplicate title ${title}`);
    titles.set(title, path);
  };
  for (const [path, text] of Object.entries(files).filter(([path]) => STORY_FILE.test(path))) {
    const title = /export default\s*\{\s*title:\s*"([^"]+)"/.exec(text)?.[1];
    if (!title) { errors.push(`${path}: missing component title`); continue; }
    titleOf(path, title);
    statusErrors(path, title, /export default\s*\{[^}]*\btags:\s*\[([^\]]*)\]/.exec(text)?.[1]);
    if (!descriptions[title.split('/').at(-1)]) errors.push(`${path}: missing component usage`);
    if (!/export const Variants = componentStory\("[^"]+"\);/.test(text) || /(?:html|render)\s*[:=][\s\S]*["'`]</.test(text)) errors.push(`${path}: repeated story markup outside the shared catalog`);
    if (!text.includes(`componentStory(${JSON.stringify(title)})`)) errors.push(`${path}: preview references another page`);
    const firstName = /name:\s*["']([^"']+)/.exec(text)?.[1] ?? (/export const (\w+)/.exec(text)?.[1]);
    if (firstName === title.split('/').at(-1)) errors.push(`${path}: docs and first story repeat a title`);
  }
  for (const [path, text] of Object.entries(files).filter(([path]) => path.endsWith('.mdx'))) {
    const explicit = /<Meta title="([^"]+)"/.exec(text)?.[1];
    if (explicit) {
      titleOf(path, explicit);
      statusErrors(path, explicit, /<Meta [^>]*\btags=\{\[([^\]]*)\]\}/.exec(text)?.[1]);
      if (!explicit.startsWith('Start/') && !/## Prompt for agents\s+```text\s+\S/.test(text)) errors.push(`${path}: missing prompt block`);
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
  const byId = new Map(records.map((record) => [record.id, record]));
  if (records.some((record) => record.gap) && (!template.includes('<h3>{FEATURE_LABEL}</h3>') || template.indexOf('<h3>{FEATURE_LABEL}</h3>') < template.indexOf('<pre className="kanso-docs__prompt">'))) errors.push('component page: missing plain feature list under Prompt for agents');
  for (const record of records) {
    if (ids.has(record.id)) errors.push(`catalog: duplicate state ${record.id}`);
    ids.add(record.id);
    if (record.html !== undefined) for (const error of explainErrors(record.html)) errors.push(`${record.id}: ${error}`);
    if (overlapFor(record) && (record.html !== undefined || (!record.design && !record.gap))) errors.push(`${record.id}: overlapping coverage must reference its design or list the feature to redesign`);
    if (record.design && (!byId.get(record.design)?.html || byId.get(record.design).page !== record.page || byId.get(record.design).source === 'coverage')) errors.push(`${record.id}: missing designed drawing`);
    if ((record.design || record.gap) && (record.html !== undefined || !/^[\w./-]+:\d+(?:-\d+)?$/.test(record.location ?? ''))) errors.push(`${record.id}: feature must have a source location and no independent drawing`);
    if (!docs.has(record.page)) errors.push(`catalog: unreachable state ${record.id}`);
    if (CODE.test([record.caption, record.context ?? '', record.label, ...(record.notes ?? []), ...(record.spec ?? []).flat()].join(' '))) errors.push(`catalog: code in visible text of ${record.id}`);
    if (/\b(?:prototypes?|boards?|designers?|agents?|subtracted|removed)\b/i.test([record.caption, record.context ?? '', record.label, ...(record.notes ?? []), ...(record.spec ?? []).flat()].join(' '))) errors.push(`catalog: source reference or outdated feature wording in ${record.id}`);
  }
  return errors;
}

// One file per composition the app shares, beside the ones it does not draw yet.
export const COMPOSITIONS = ['stories/kit/compositions.js', 'stories/kit/session-row.js', 'stories/kit/project-row.js', 'stories/kit/computer-row.js', 'stories/kit/section.js', 'stories/kit/asleep.js', 'stories/kit/tile.js', 'stories/kit/view-switch.js', 'stories/kit/toolbar.js', 'stories/kit/header.js', 'stories/kit/sidebar-footer.js', 'stories/kit/status-bar.js', 'stories/kit/activity.js'];

// Compositions only call pieces and never treat them as strings, so the app can share the file as it is.
export function compositionErrors(source, path = 'stories/kit/compositions.js') {
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  const bare = code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, 'text');
  const imports = [...code.matchAll(/\bfrom\s*(['"])([^'"]*)\1/g)].map((match) => match[2]);
  const rules = [
    [/<\/?[a-z!]/i.test(code), 'markup tag'],
    [/\bclass(?:Name)?\s*=/.test(code), 'class attribute'],
    [/\bkanso-[a-z]/.test(code), 'class string'],
    [/`/.test(code), 'template literal'],
    [/\.join\(/.test(bare), 'join'],
    [/''|""/.test(code), 'empty string as nothing'],
    [/\+|\.concat\(|\bString\(|\.toString\(/.test(bare), 'pieces added as strings'],
    [imports.some((from) => from !== './kit.js') || /\bimport\s*(?:\(|['"])|\brequire\s*\(/.test(code), 'import from outside the pieces'],
  ];
  return rules.filter(([found]) => found).map(([, rule]) => `${path}: ${rule} in a composition`);
}

// Every element a page draws comes from a primitive: a class primitives.css owns, a token from utilities.css, or the frame around the story.
export function primitiveErrors(records, owned, tokens) {
  const pageErrors = ({ page, html }) => {
    const kit = (name) => !FRAME.test(name) && !tokens.has(name);
    const drawn = (node) => node.classes.filter((name) => name && kit(name));
    const own = (node) => drawn(node).filter((name) => !(page.startsWith('Tokens/') && SWATCH.test(name)));
    const inside = (node) => Boolean(node.parent) && (drawn(node.parent).length > 0 || inside(node.parent));
    return markupElements(html).flatMap((node) => {
      const names = own(node);
      const foreign = names.filter((name) => !owned.has(name)).map((name) => `<${node.tag}> ${name} is not a primitive`);
      return drawn(node).length || inside(node) || node.classes.some((name) => FRAME.test(name)) ? foreign : [`<${node.tag}> raw markup outside a primitive`];
    }).map((error) => `${page}: ${error}`);
  };
  return records.filter((record) => record.html !== undefined && !record.fragment).flatMap(pageErrors);
}

// A size passed as geometry data is a token unless the element is placed on the board: a bare number there is board pixels.
const PLACED = /\sdata-(?:left|top|right|bottom)="/;
const bareSizes = (text) => [...text.matchAll(/<[a-z][^>]*>/gi)].filter(([tag]) => !PLACED.test(tag))
  .flatMap(([tag]) => [...tag.matchAll(/data-(?:width|height|radius|max)="(?!0")-?\d*\.?\d+(?:px)?"/g)]);

// Values a story writes itself instead of taking a token or a primitive: inline styles, and raw px or colours outside them.
export function rawValues(source, text, css = false) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const inline = [...code.matchAll(INLINE)].map(([found]) => `inline ${found}`);
  const rest = code.replace(INLINE, '');
  const raw = css
    ? [...rest.matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)].map(([found]) => found.trim()).filter((found) => RAW.test(found))
    : [...rest.matchAll(new RegExp(RAW, 'gi')), ...bareSizes(rest)].map(([found]) => found);
  return [...inline, ...raw.map((found) => `raw ${found}`)].map((value) => ({ source, value }));
}

// Text a story shows, in its content or its accessible names, is not a style: a pull request number such as #142 is not a colour.
export const markupTags = (html) => (html.match(/<[^>]*>/g)?.join('') ?? '').replace(/\s(?:title|aria-label|alt)="[^"]*"/g, '');

export function rawValueReport(root = '.') {
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const code = RAW_CODE.flatMap((dir) => readdirSync(join(root, dir)).filter((name) => /\.(?:m?js|jsx|mdx)$/.test(name)).sort().map((name) => `${dir}/${name}`));
  return [
    ...RAW_CSS.flatMap((file) => rawValues(file, read(file), true)),
    ...code.flatMap((file) => rawValues(file, read(file))),
    ...expand(JSON.parse(read('stories/catalog.json'))).filter((record) => record.html !== undefined).flatMap((record) => rawValues(record.id, markupTags(record.html)).filter(({ value }) => !(record.page.startsWith('Tokens/') && value.startsWith('raw ')))),
  ];
}

// The baseline holds the raw values found when the check began; a new one fails, and so does one listed after it is gone.
export function rawValueErrors(found, baseline) {
  const key = ({ source, value }) => JSON.stringify([source, value]);
  const count = (list) => list.reduce((counts, entry) => counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1), new Map());
  const [now, then] = [count(found), count(baseline)];
  const over = (a, b) => [...a].filter(([entry, n]) => n > (b.get(entry) ?? 0)).map(([entry]) => JSON.parse(entry));
  return [
    ...over(now, then).map(([source, value]) => `${source}: ${value} is not a token or a primitive`),
    ...over(then, now).map(([source, value]) => `${RAW_VALUES} lists ${source}: ${value}, which is gone: run npm run lint:storybook -- --write`),
  ];
}

const renderRaw = (found) => `[\n${found.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`;

export function primitivesDocument(errors) {
  const unique = [...new Set(errors)];
  const pages = Map.groupBy(unique, (error) => error.slice(0, error.indexOf(': ')));
  const sections = [...pages].sort(([a, left], [b, right]) => right.length - left.length || a.localeCompare(b))
    .map(([page, list]) => [`## ${page} (${list.length})`, '', ...list.map((error) => `- ${error.slice(page.length + 2)}`), ''].join('\n'));
  return ['# Primitives to do', '', 'Elements a page draws outside a primitive (stories/primitives.css) or a token (stories/utilities.css). `npm run lint:storybook -- --todo` rewrites this list.', '', `Total: ${errors.length} elements, ${unique.length} distinct`, '', ...sections].join('\n');
}

const sheetClasses = (css) => new Set(cssSelectors(css).flatMap(selectorClasses));
export const primitiveReport = (root = '.') => {
  const read = (file) => readFileSync(join(root, file), 'utf8');
  return primitiveErrors(expand(JSON.parse(read('stories/catalog.json'))), sheetClasses(read('stories/primitives.css')), sheetClasses(read('stories/utilities.css')));
};

export function lint(root = '.') {
  const catalog = JSON.parse(readFileSync(join(root, 'stories/catalog.json'), 'utf8'));
  const errors = structureErrors(storyFiles(join(root, 'stories')), catalog, readFileSync(join(root, 'stories/kit/ComponentPage.jsx'), 'utf8'));
  if (readFileSync(join(root, 'stories/GAPS.md'), 'utf8') !== gapDocument(expand(catalog))) errors.push('GAPS.md: feature inventory differs from component pages');
  const read = (file) => readFileSync(join(root, file), 'utf8');
  errors.push(...COMPOSITIONS.flatMap((file) => compositionErrors(read(file), file)));
  const [, canvas, docs] = /frame\.className = [^?]+\? '([^']+)' : '([^']+)'/.exec(read('.storybook/preview.js')) ?? [];
  const classes = [
    ['.storybook/preview.js', `${canvas ?? ''} ${docs ?? ''}`.split(/\s+/).filter(Boolean)],
    ...['stories/primitives.css', 'stories/compositions.css', 'stories/proto.css', 'stories/frame.css', 'stories/utilities.css', '.storybook/preview-head.html'].map((file) => [file, cssSelectors(read(file)).flatMap(selectorClasses)]),
    ...expand(catalog).filter((record) => record.html !== undefined).map((record) => [record.id, markupClasses(record.html)]),
    ...['stories/start', 'stories/components', 'stories/kit'].flatMap((dir) => readdirSync(join(root, dir)).filter((name) => /\.(mdx|jsx)$/.test(name)).map((name) => [`${dir}/${name}`, markupClasses(read(`${dir}/${name}`))])),
  ];
  for (const [source, names] of classes) for (const name of names) if (!BEM.test(name) && !STORYBOOK_CLASSES.has(name)) errors.push(`${source}: ${name} is not kanso BEM`);
  if (!canvas) errors.push('.storybook/preview.js: frame classes not found');
  errors.push(...rawValueErrors(rawValueReport(root), JSON.parse(read(RAW_VALUES))));
  if (PRIMITIVES_ENFORCED) errors.push(...primitiveReport(root));
  return errors;
}

if (isMain(import.meta.url)) {
  const primitives = primitiveReport();
  if (process.argv.includes('--todo')) writeFileSync(PRIMITIVES_TODO, primitivesDocument(primitives));
  if (process.argv.includes('--write')) writeFileSync(RAW_VALUES, renderRaw(rawValueReport()));
  if (!PRIMITIVES_ENFORCED) console.log(`${primitives.length} elements (${new Set(primitives).size} distinct) outside a primitive, listed in ${PRIMITIVES_TODO}`);
  const errors = lint();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Storybook structure passed');
}
