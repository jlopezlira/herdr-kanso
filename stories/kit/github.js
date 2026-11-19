import { bars, code, explainButton, failureBlock, failureLine, list, menu, phrase, stack } from './kit.js';
import { panel, panelRefresh } from './compositions.js';
import { branchRow, dimLine, heading, line, panelHeader, pullContent, pullPages, pullRow, quietAct, row, settings, waiting } from './panels.js';

const counted = (word, items) => (items.length ? phrase(word, items.length) : null);
const factsOf = ({ needs, yours, stale }) => [counted('Needs you', needs), counted('Yours', yours), stale ? { text: stale, tone: 'dim' } : null].filter(Boolean);
const hints = (...texts) => texts.map((text) => ({ text }));

const pulls = (title, items, { depth, focus }) => (items.length
  ? list(heading(title, { depth, chip: String(items.length) }), items.map((item) => pullRow(null)({ ...item, depth, focus: focus === item.number, keys: focus === item.number ? hints('↵', 'A') : [] })))
  : null);

const block = ({ name, needs, yours, checks, stale, failure = null, branch = null }, { open = false, hover = null, focus = null, shown = {} }) => list(
  row({ level: 0, open, name, second: factsOf({ needs, yours, stale: shown.stale === false ? null : stale }), meta: shown.checks === false ? null : checks,
    hover: hover === name, focus: focus === name, keys: focus === name ? hints('↵') : [], action: hover === name ? { label: 'Open the list', kind: 'quiet' } : null }),
  failure ? failureLine(failure) : null,
  open ? list(branch ? branchRow(branch) : null, pulls('Needs you', needs, { depth: 1, focus }), pulls('Yours', yours, { depth: 1, focus })) : null);

const single = ({ needs, yours, branch }, { focus = null }) => list(branch ? branchRow(branch) : null,
  pulls('Needs you', needs, { depth: 0, focus }), pulls('Yours', yours, { depth: 0, focus }));

const statistics = ({ summary, oldest, review, fresh, waited, ages, shipped }, open) => list(
  row({ level: 0, open, name: 'Statistics', meta: open ? null : summary }),
  open ? list([oldest, review, fresh].map(([name, value]) => row({ name, detail: value })), dimLine(waited), bars(ages), row({ name: shipped, dimmed: true, action: { label: 'Open Shipped', kind: 'quiet' } })) : null);

const boardBody = ({ blocks = [], block: only = null, missing = null, stats = null, statsOpen = false, reading = false, looking = null, failure = null, empty = null, ...state }) => {
  const held = waiting({ failure, empty });
  if (held) return held;
  if (looking) return list(dimLine(looking), waiting({ reading: true }, 4));
  if (reading) return waiting({ reading }, 4);
  if (only) return single(only, state);
  return list(stats ? statistics(stats, statsOpen) : null, blocks.map((item) => block(item, { ...state, open: state.open === item.name })),
    missing ? row({ name: missing.name, second: missing.second, dimmed: true }) : null);
};

const logBody = ({ text, agent, outcome = null, keys = false }) => list(code(text), outcome, line(quietAct('Re-run', keys ? 'E' : null), explainButton({ agent, size: 'sm' })));

const headers = { ...pullPages, board: ({ scope = null, reading = false }) => panelHeader({ title: 'Pull requests', second: scope, tools: [panelRefresh({ reading })] }) };
const contents = { ...pullContent, board: boardBody, log: logBody };
const githubPanel = ({ page = 'board', look = 'panel', stale = false, ...props }) => panel({ look, stale, header: headers[page](props) }, contents[page](props));

const drawn = ({ picker = null, ...props }) => (picker ? stack({ variant: 'columns' }, githubPanel(props), menu(picker)) : githubPanel(props));
export const github = ({ settingsOf = null, ...props }) => (settingsOf ? settings(settingsOf) : drawn(props));

export const outcomeLine = ({ state, said, undo = false, failure = null }) => (state === 'refused'
  ? failureBlock(failure)
  : row({ icon: 'lu-check', name: said, meta: 'now', pending: state === 'pending', action: state === 'done' && undo ? { label: 'Undo', kind: 'quiet' } : null }));
