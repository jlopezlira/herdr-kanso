import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeComponent } from './storybook-components.mjs';
import { normalizeCss } from './storybook-css.mjs';
import { kitRecords, tokenRecords } from './storybook-kit.mjs';
import { gapDocument, mergeCoverage } from './storybook-coverage.mjs';

export const SECTIONS = ['Start', 'Tokens', 'Primitives', 'Compositions', 'Panels', 'Layouts'];
export const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const cleanText = (s = '') => s.replace(/; [^;.]+ keeps this component and its states in the shared kit\./g, '.').replace(/\b(?:prototype|board)(?:s|'s)?\b/gi, 'example').replace(/\bdesigners?\b/gi, 'reader').replace(/\bagents?\b/gi, (s) => s[0] === 'A' ? 'Session' : 'session').replace(/\ban? session\b/gi, 'a session').replace(/\bsubtracted\b/gi, 'simplified').replace(/\bremoved facts?\b/gi, 'simplified information').replace(/\bremoved\b/gi, 'cleared');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function pack(records) {
  const parts = [], keys = new Map();
  const intern = (value) => {
    const key = JSON.stringify(value);
    if (!keys.has(key)) { keys.set(key, parts.length); parts.push(value); }
    return keys.get(key);
  };
  const markup = (html) => {
    const stack = [{ tag: '', children: [] }];
    for (const token of html.match(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</g) ?? []) {
      const tag = /^<([a-z][\w:-]*)\b/i.exec(token)?.[1].toLowerCase();
      const close = /^<\/([a-z][\w:-]*)/i.exec(token)?.[1].toLowerCase();
      if (close && stack.length > 1 && stack.at(-1).tag === close) {
        const node = stack.pop();
        node.children.push(intern(token));
        stack.at(-1).children.push(intern(node.children));
      } else if (tag && !/\/\s*>$/.test(token) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
        stack.push({ tag, children: [intern(token)] });
      } else stack.at(-1).children.push(intern(token));
    }
    while (stack.length > 1) stack.at(-2).children.push(intern(stack.pop().children));
    return intern(stack[0].children);
  };
  const prose = (text) => intern(cleanText(text).split(/(\n+)/).map(intern));
  const encoded = records.map(({ html, caption, context, spec, notes, ...record }) => ({
    ...record, label: cleanText(record.label), ...(html !== undefined ? { markup: markup(html) } : {}), caption: prose(caption),
    ...(context ? { context: prose(context) } : {}),
    ...(spec ? { spec: spec.map(([label, value]) => [intern(label), prose(value)]) } : {}),
    ...(notes?.length ? { notes: notes.map(prose) } : {}),
  }));
  return { format: 1, parts, records: encoded };
}

export function expand(catalog) {
  const cache = new Map();
  const value = (id) => {
    if (!cache.has(id)) cache.set(id, typeof catalog.parts[id] === 'string' ? catalog.parts[id] : catalog.parts[id].map(value).join(''));
    return cache.get(id);
  };
  return catalog.records.map(({ markup, caption, context, spec, notes, ...record }) => ({ ...record, ...(markup !== undefined ? { html: value(markup) } : {}), caption: value(caption),
    ...(context !== undefined ? { context: value(context) } : {}),
    ...(spec ? { spec: spec.map((row) => row.map(value)) } : {}), ...(notes ? { notes: notes.map(value) } : {}),
  }));
}

const serialize = (catalog) => `{\n "format": ${catalog.format},\n "parts": [\n${catalog.parts.map((part) => '  ' + JSON.stringify(part)).join(',\n')}\n ],\n "records": [\n${catalog.records.map((record) => '  ' + JSON.stringify(record)).join(',\n')}\n ]\n}\n`;

export function replaceSource(source, records, root = '.') {
  pagesOf(records);
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('Duplicate state ids');
  const file = join(root, 'stories/catalog.json');
  const previous = existsSync(file) ? expand(read(file)).filter((record) => record.source !== source) : [];
  const catalog = pack([...previous, ...records.map((record) => ({ ...record, source }))].filter((record) => !['kit', 'tokens'].includes(record.source)).sort((a, b) => a.id.localeCompare(b.id)));
  mkdirSync(join(root, 'stories'), { recursive: true });
  writeFileSync(file, serialize(catalog));
  generate(root);
}

const primitive = {
  KeyHint: 'Key hint', PillAndAvatar: 'Chip', Switch: 'Switch', Segmented: 'Segmented', Field: 'Field',
  ButtonsFourKinds: 'Button', ButtonsOnALine: 'Button', ActionRows: 'Button', ButtonWithAMark: 'Button', Armed: 'Button',
  FocusRing: 'Button', HoverSelectedPressed: 'Button', Tooltip: 'Tooltip', ChromeAndBarButtons: 'Button',
  Computer: 'Row', Project: 'Row', AgentOneLine: 'Row', AgentTwoLines: 'Row', SubAgent: 'Row', Asleep: 'Row', WorktreeRow: 'Row', DropTarget: 'Row',
  FileRow: 'Row', PortRow: 'Row', RowActions: 'Row', SettingRow: 'Row', SettingRowWithAValue: 'Row', FindRow: 'Row',
  Card: 'Card', Metric: 'Metric', ThumbnailStrip: 'Thumbnail', SkeletonTwoLines: 'Skeleton', Loading: 'Skeleton',
  Toast: 'Toast', ToastWithItsSource: 'Toast', Snippet: 'Code', Reply: 'Markdown', Picture: 'Thumbnail',
};
const protoPage = {
  'components-annotated-picture': 'Panels/Pins', 'components-choosing-the-channel': 'Panels/Settings',
  'components-code': 'Primitives/Code', 'components-collapsed-rail': 'Compositions/Rail',
  'components-dialog': 'Primitives/Dialog', 'components-edges-and-minimap': 'Compositions/Edge and Minimap',
  'components-find-in-the-conversation': 'Panels/Find', 'components-header-digest': 'Compositions/Header',
  'components-log': 'Primitives/Log', 'components-markdown-window': 'Panels/Markdown', 'components-markdown': 'Primitives/Markdown',
  'components-menu': 'Primitives/Menu', 'components-new-project': 'Primitives/Dialog', 'components-new-worktree': 'Primitives/Dialog',
  'components-pane-header': 'Compositions/Header', 'components-pane-standing-in': 'Compositions/Bars', 'components-panel-menu': 'Primitives/Menu',
  'components-pick-list': 'Primitives/Menu', 'components-rename': 'Primitives/Dialog', 'components-settings-tabs': 'Panels/Settings',
  'components-shipped': 'Panels/Shipped', 'components-simulator-screen': 'Panels/Simulator',
  'components-status-bar-working': 'Compositions/Status bar', 'components-status-bar': 'Compositions/Status bar',
  'components-system-notification': 'Compositions/Notifications', 'components-tab-bar': 'Compositions/Bars', 'components-tab-states': 'Primitives/Tab',
  'components-title-and-tools': 'Compositions/Header', 'components-while-you-were-away': 'Compositions/Activity', 'components-worktree-row-open': 'Primitives/Row',
  'compositions-bars': 'Compositions/Bars', 'compositions-controls': 'Primitives/Button', 'compositions-files-and-pr': 'Panels/PR',
  'compositions-menu-and-dialog': 'Primitives/Dialog', 'compositions-panel-pieces': 'Compositions/Panel shell',
  'compositions-sidebar-rows': 'Compositions/Sidebar', 'compositions-states': 'Compositions/State patterns',
  'layouts-sidebar-at-rest': 'Compositions/Sidebar', 'layouts-sidebar-header-three-ways': 'Compositions/Header',
  'layouts-window-at-rest': 'Layouts/Window', 'layouts-right-click-any-piece': 'Layouts/Context menus', 'layouts-hjkl-dojo': 'Layouts/Practice',
  'tokens-colour-and-wash': 'Tokens/Colour', 'tokens-dawn': 'Compositions/Sidebar', 'tokens-icons': 'Tokens/Icons', 'tokens-type': 'Tokens/Type',
};
const coveragePage = {
  Arrangements: 'Panels/Arrangements', SaveArrangement: 'Primitives/Dialog', SettingsMenu: 'Primitives/Menu', UpdateNotice: 'Compositions/Notifications', RuntimeNotice: 'Compositions/Notifications',
  ContainerList: 'Panels/Containers', ContainerRow: 'Panels/Containers', ComposeProject: 'Panels/Containers', ContainerDisk: 'Panels/Containers',
  Practice: 'Panels/Dojo', PracticeFeedback: 'Panels/Dojo', PracticeResult: 'Panels/Dojo', PracticePet: 'Panels/Dojo',
  Memory: 'Panels/Memory', MemoryAgent: 'Panels/Memory', MemoryRecovery: 'Panels/Memory', MemoryHistory: 'Panels/Memory', MemoryChart: 'Primitives/Chart', SystemNotice: 'Compositions/Notifications',
  Help: 'Panels/Help', Guide: 'Panels/Help', KeyboardExplorer: 'Compositions/Keyboard', MarkdownFiles: 'Panels/Markdown', MarkdownReview: 'Panels/Markdown',
  PaneMenu: 'Primitives/Menu', OpenWith: 'Primitives/Dialog', Files: 'Panels/Files', Preview: 'Panels/Preview', MarkdownEditing: 'Panels/Preview', ConversationFind: 'Panels/Find',
  Images: 'Panels/Images', Ports: 'Panels/Ports', PortHistory: 'Panels/Ports', PullRequest: 'Panels/PR', PullRequestContext: 'Panels/PR', PullRequestList: 'Panels/PR', PullRequestDetails: 'Panels/PR', PullRequestPicker: 'Panels/PR',
  WorktreeVerdict: 'Panels/Worktrees', Worktrees: 'Panels/Worktrees', WorktreeHistory: 'Panels/Worktrees', Shipped: 'Panels/Shipped', Share: 'Panels/Share', VerdictBody: 'Panels/PR', CodeLimits: 'Primitives/Code', HistoryChart: 'Primitives/Chart', ActionNotice: 'Primitives/Toast', ShareCard: 'Panels/Share',
  MultilinePrompt: 'Primitives/Field', Prompt: 'Primitives/Dialog', SendDialog: 'Primitives/Dialog', Pieces: 'Panels/Settings', Bindings: 'Panels/Settings', ReleaseControls: 'Panels/Settings', CreditsLoading: 'Panels/Settings',
  Devices: 'Panels/Simulator', DeviceControls: 'Panels/Simulator', PictureState: 'Panels/Simulator', SleepDialog: 'Primitives/Dialog',
  Sidebar: 'Compositions/Sidebar', SidebarStatus: 'Compositions/Sidebar', SidebarThreads: 'Compositions/Sidebar', SidebarSort: 'Compositions/Sidebar', ProjectGit: 'Compositions/Sidebar',
  ProjectMenu: 'Primitives/Menu', AgentMenu: 'Primitives/Menu', NewConversation: 'Primitives/Dialog', ProjectCreation: 'Primitives/Dialog', ComputerMenu: 'Primitives/Menu', Asleep: 'Compositions/Sidebar', NeedsQueue: 'Compositions/Sidebar', AwayEvents: 'Compositions/Activity', CreateWorktree: 'Primitives/Dialog',
  Spend: 'Panels/Spend', SpendBreakdown: 'Panels/Spend', SpendSettings: 'Panels/Spend', SpendChart: 'Primitives/Chart', StatusStandIn: 'Compositions/Status bar', PaneTools: 'Compositions/Header', StripNavigation: 'Compositions/Bars', Tabs: 'Primitives/Tab', PanelToolbar: 'Compositions/Bars', Notice: 'Primitives/Toast', NoticeStack: 'Primitives/Toast',
};

export function pageFor(source, file, key) {
  const base = file.replace(/\.(json|stories\.js)$/, '');
  if (source === 'panels') return ({ skeleton: 'Compositions/Panel shell', availability: 'Compositions/State patterns' })[base] ?? `Panels/${base === 'pr' ? 'PR' : base[0].toUpperCase() + base.slice(1)}`;
  if (source === 'coverage') {
    if (!coveragePage[key]) throw new Error(`Missing component route: ${file}:${key}`);
    return coveragePage[key];
  }
  if (source === 'proto') {
    if (primitive[key] && /compositions-/.test(base)) return `Primitives/${primitive[key]}`;
    if (!protoPage[base]) {
      if (base.startsWith('components-')) return `Primitives/${base.slice(11).replace(/-/g, ' ').replace(/^./, (s) => s.toUpperCase())}`;
      throw new Error(`Missing component route: ${file}:${key}`);
    }
    return protoPage[base];
  }
  throw new Error(`Unknown story source: ${source}`);
}

export function recordsFrom(source, file, data, notes = []) {
  return Object.entries(data).flatMap(([key, story]) => Object.entries(story.variants ?? { Default: story }).map(([state, variant]) => ({
    id: `${source}/${file.replace(/\.json$/, '')}/${key}/${state}`, source, page: pageFor(source, file, key),
    label: cleanText([story.name ?? story.title ?? key.replace(/([a-z])([A-Z])/g, '$1 $2'), ...(story.variants ? [state] : [])].join(' · ')),
    caption: variant.when ?? story.caption ?? '', ...(story.variants && story.caption ? { context: story.caption } : {}), html: variant.html, ...(variant.spec ? { spec: variant.spec } : {}),
    ...(variant.source ? { location: variant.source } : {}), ...(notes.length ? { notes } : {}),
  })));
}

export function pagesOf(records) {
  const pages = new Map();
  for (const record of records) {
    if (!SECTIONS.slice(1).some((section) => record.page.startsWith(section + '/'))) throw new Error(`Invalid page: ${record.page}`);
    if (!pages.has(record.page)) pages.set(record.page, []);
    pages.get(record.page).push(record);
  }
  return [...pages].sort(([a], [b]) => SECTIONS.indexOf(a.split('/')[0]) - SECTIONS.indexOf(b.split('/')[0]) || a.localeCompare(b));
}

export function generate(root = '.') {
  const file = join(root, 'stories/catalog.json');
  const originals = mergeCoverage(expand(read(file)).filter((record) => !['kit', 'tokens'].includes(record.source)).map((record) => record.html === undefined ? record : normalizeComponent(record)));
  const tokenFile = join(root, 'kanso/tokens.json');
  const tokens = existsSync(tokenFile) ? read(tokenFile) : null;
  const catalog = pack([...originals, ...kitRecords(originals).map(normalizeComponent), ...(tokens ? tokenRecords(tokens) : [])]);
  writeFileSync(file, serialize(catalog));
  writeFileSync(join(root, 'stories/GAPS.md'), gapDocument(expand(catalog)));
  const pages = pagesOf(expand(catalog));
  const cssFile = join(root, 'stories/proto.css');
  if (existsSync(cssFile)) writeFileSync(cssFile, normalizeCss(readFileSync(cssFile, 'utf8'), { kit: true }));
  const out = join(root, 'stories/components');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [page] of pages) {
    const file = slug(page);
    writeFileSync(join(out, `${file}.stories.js`), `import { componentStory } from '../kit/story.js';\n\nexport default { title: ${JSON.stringify(page)} };\nexport const Variants = componentStory(${JSON.stringify(page)});\n`);
    writeFileSync(join(out, `${file}.mdx`), `import { Meta } from '@storybook/addon-docs/blocks';\nimport * as stories from './${file}.stories.js';\nimport { ComponentPage } from '../kit/ComponentPage.jsx';\n\n<Meta of={stories} name="Overview" />\n<ComponentPage of={stories} page=${JSON.stringify(page)} />\n`);
  }
  return { stories: pages.length, states: catalog.records.filter((record) => record.markup !== undefined).length, covered: catalog.records.filter((record) => record.design).length, gaps: catalog.records.filter((record) => record.gap).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(generate()));
