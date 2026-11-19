import { pullRequest } from './samples.js';

const piece = (name, extra = {}) => ({ name, on: true, ...extra });
export const sampleAreas = {
  Sidebar: {
    stops: 'Hiding one stops its read: agents ps, branches git.',
    pieces: [piece('Projects, Status, Threads'), piece('What each agent is on'), piece('Time in its state', { on: false }), piece('Commands still running'), piece('Branch, ahead, behind'),
      piece('While you were away', { when: 'only when something happened' }), piece('Needs you', { when: 'only when one waits' }), piece('Computers'), piece('Add a computer')],
  },
  'Pane header': {
    stops: 'Hiding one stops its read: changes git, pull requests gh.',
    pieces: [piece('Folder and branch'), piece('Files and commits', { when: 'only when changed' }), piece('PR', { when: 'only when one is open' })],
  },
  'Status bar': {
    stops: 'Hiding one stops its check: servers lsof every 60 s, containers docker every 60 s, reviews gh every 2 min.',
    pieces: [piece('Computer and branch'), piece('Needs you', { when: 'only when one waits' }), piece('Memory low', { when: 'only when low' }), piece('Servers with no pane', { when: 'only when one runs' }),
      piece('Failed containers', { when: 'only when one fails' }), piece('Reviews waiting', { when: 'only when asked' }), piece('Agents at work'), piece('Spend today', { on: false }), piece('Minimap', { on: false }), piece('Command palette key', { on: false })],
  },
  'Tab bar': { stops: null, pieces: [piece('Arrangements'), piece('New tab')] },
  Panels: {
    stops: 'Hiding one stops its read: files and worktrees git, pull requests gh, ports lsof, containers docker, memory ps.',
    order: true,
    pieces: [piece('Files'), piece('Spend'), piece('PR'), piece('Shipped'), piece('Worktrees'), piece('Ports'), piece('Containers'), piece('Memory'), piece('Images', { on: false }), piece('Simulator', { on: false })],
  },
  Notifications: { stops: null, pieces: [piece('kansō update', { on: false }), piece('Memory low')] },
  'Behind the scenes': { stops: 'Each one is work kansō does while you do not look.', pieces: [piece('Check for updates'), piece('Memory guard', { on: false })] },
};
export const sampleHidden = [['Time in its state', 'Sidebar'], ['Minimap', 'Status bar'], ['Command palette key', 'Status bar'], ['Images', 'Panels'], ['Simulator', 'Panels'], ['kansō update', 'Notifications']];
export const sampleCustomPanel = piece('Project notes');
export const sampleFound = { query: 'memory', rows: [['Memory low', 'Status bar'], ['Memory', 'Panels'], ['Memory low', 'Notifications'], ['Memory guard', 'Behind the scenes', false]] };

const action = (name, chords) => ({ name, chords });
export const sampleKeyGroups = {
  Panels: [action('Open or close a panel', ['⌥⌘1…9']), action('Simulator', ['⌥⌘0']), action('kansō settings', ['⌃⇧,'])],
  Sidebar: [action('Projects', ['⌥⌘1']), action('Status', ['⌥⌘2']), action('Threads', ['⌥⌘3'])],
  Panes: [action('New pane to the left', ['⌥⌘N']), action('Next agent that needs you', ['⌥⌘Y']), action('Agent above', ['⌥⌘↑']), action('Agent below', ['⌥⌘↓']), action('Pin the pane to its side', ['⌥⌘P'])],
  'Vim keys': [action('Pane to the left, or the sidebar’s list', ['⌥⌘H']), action('Pane below', ['⌥⌘J']), action('Pane above', ['⌥⌘K']), action('Pane to the right', ['⌥⌘L']),
    action('Move the pane left', ['⌥⇧⌘H']), action('Move the pane down', ['⌥⇧⌘J']), action('Move the pane up', ['⌥⇧⌘K']), action('Move the pane right', ['⌥⇧⌘L'])],
  'Moving along the strip': [action('Go to a column', ['⌘1…9']), action('First column', ['⌘⇧[']), action('Last column', ['⌘⇧]']), action('Bring the pane into view', ['⌥⌘C']),
    action('Slide left', ['⌥⌘,']), action('Slide right', ['⌥⌘.']), action('Fewer panes in view', ['⌥⌘-']), action('More panes in view', ['⌥⌘=']), action('Even the columns out', ['⌥⌘0'])],
  'Spend, Preview, Memory': [action('Spend: read again', ['⌘R']), action('Spend’s settings', ['⌘,']), action('Spend: back', ['Esc']), action('Preview: save the file', ['⌘S']), action('Memory: check now', ['⌘R']), action('Memory: show fewer', ['Esc'])],
  'Every list and menu': [action('Down and up', ['j', 'k']), action('First and last', ['gg', 'G']), action('Open', ['Enter']), action('Find', ['/'])],
};
export const sampleHerdrKeys = 31;
export const sampleTaken = { chord: '⌘R', name: 'Check now' };

const release = (version, date, changes = []) => ({ version, date, changes });
export const sampleReleases = {
  newer: release('3.31.0', 'today · Nov 11', [
    { kind: 'Added', text: 'Every piece can be shown, shown only when it has something to say, or hidden. Hiding it stops the work behind it. Settings opens on that list.' },
    { kind: 'Added', text: 'Any file that is not a picture opens from Files into Preview. Any text file up to 1 MB can be edited, on this computer or another.' },
    { kind: 'Changed', text: 'The pull request panel opens on what stops it (the failing step and its last log lines, or the review comment), with one action.' },
  ]),
  dawn: release('3.32.0-beta.2', 'today · Nov 12', [{ kind: 'Changed', text: 'Settings and Memory use the shared kit.' }]),
  installed: release('3.30.0', 'Nov 4', [{ kind: 'Changed', text: 'The sidebar reads each computer once, whatever its rows ask.' }]),
  older: { from: '3.29.0', to: '3.27.0' },
};

export const samplePlaces = [
  { name: 'Herdr', note: 'The app kansō runs in', url: 'herdr.dev' },
  { name: 'kansō', note: 'Source, releases and issues', url: 'github.com/jlopezlira/herdr-kanso' },
  { name: 'Lucide (ISC)', note: 'Toolbar icons', url: 'lucide.dev' },
];
const maker = (name, login) => ({ name, handle: `@${login} on GitHub` });
export const sampleMaintainers = [maker('JJ', 'jlopezlira'), maker('Iván Campaña', 'icampana'), maker('Leangseu Kim', 'leangseu'), maker('Johannes Hund', 'h0ru5')];

const hit = (who, when, text) => ({ who, when, text });
export const sampleFind = {
  agent: 'checkout',
  query: 'Retry-After',
  days: [
    ['Today', [hit('You', '14:02', 'Rate limit POST /checkout per customer and send a Retry-After header'), hit('Claude', '14:09', 'The 429 now carries Retry-After, in seconds, from the bucket’s refill time')]],
    ['Yesterday', [hit('Claude', '17:40', 'cart-ui can read Retry-After to show the countdown')]],
  ],
  turn: 'The 429 now carries Retry-After, in seconds, from the bucket’s refill time. limits.ts exports refillIn(customer) and checkout.ts sets the header before it returns. Tests: 21 passed.',
  missing: '~/.claude/projects/acme-shop/4f2a.jsonl: no such file',
};

const changed = (name, folder, stat, letter = 'M') => ({ name, folder, stat, letter });
export const sampleFiles = {
  named: [changed('limits.ts', 'src/api', '+22', 'A'), changed('checkout.ts', 'src/api', '+14 −3')],
  unchanged: ['plans.ts', 'Cart.tsx', 'limits.md'],
  also: [changed('limits.test.ts', 'src/api', '+6 −4')],
  shell: [changed('RetryIn.tsx', 'src/web', '+22', 'A')],
  remote: { named: [changed('limits.ts', 'src/api', '+22', 'A'), changed('checkout.ts', 'src/api', '+14 −3')], unchanged: [], also: [changed('limits.test.ts', 'src/api', '+6 −4')] },
  computer: 'devbox',
  menu: { path: 'src/api/checkout.ts' },
};
const folder = (name, level, open, count = null) => ({ name, level, open, count });
const file = (name, level, letter = null) => ({ name, level, letter });
export const sampleTree = [folder('.github', 0, false), folder('docs', 0, false), folder('src', 0, true, '3'), folder('api', 1, true, '3'),
  file('checkout.ts', 2, 'M'), file('limits.test.ts', 2, 'M'), file('limits.ts', 2, 'A'), file('plans.ts', 2), folder('web', 1, false),
  folder('fixtures', 0, true), file('orders-0001.json', 1), { more: '1,214 more not listed', level: 1 }, file('package.json', 0)];
export const samplePlainTree = [folder('private', 0, true), { failure: { text: 'Can’t list this folder', source: 'EACCES: permission denied, scandir \'/Users/jj/notes/private\'', fix: 'Refresh' }, level: 1 },
  file('rate-limits.md', 0), file('standup.md', 0)];
export const sampleFilesFailures = {
  folder: { text: 'Can’t list ~/acme-shop', source: 'EACCES: permission denied, scandir \'/Users/jj/acme-shop\'', fix: 'Refresh', agent: 'checkout' },
  unreachable: { text: 'Can’t reach devbox', source: 'ssh: connect to host devbox port 22: Operation timed out', fix: 'Refresh' },
};

const server = (port, what, size, command, folder, age, pane = null) => ({ port, what, size, command, folder, age, pane });
export const samplePorts = {
  noPane: [server(':6006', 'storybook', '388 MB', 'storybook dev -p 6006', '~/acme-shop-cart', '2 h'), server(':3001', 'next', '214 MB', 'next dev -p 3001', '~/acme-shop-docs', '5 h')],
  inPanes: [server(':4000', 'tsx', '146 MB', 'tsx watch src/server.ts', '~/acme-shop', '1 h', 'checkout'), server(':5173', 'vite', '182 MB', 'vite --port 5173', '~/acme-shop', '40 min', 'web')],
  remote: { noPane: [server(':8000', 'uvicorn', '96 MB', 'uvicorn app:api --port 8000', '~/billing', '3 h')], inPanes: [server(':5432', 'postgres', '64 MB', 'postgres -D data', '~/billing', '1 d', 'migrate')] },
  computer: sampleFiles.computer,
  everywhere: { scope: 'All computers', here: 'dark' },
  light: { name: 'light', count: '1', servers: [server(':5174', 'vite', '160 MB', 'vite --port 5174', '~/docs-site', '20 min', 'docs')] },
  lightOut: [{ name: 'light', lacks: 'unreachable' }, { name: 'build', lacks: 'lsof is not installed' }],
  entry: { icon: 'lu-plug', text: ':6006 no pane', tone: 'working' },
  refused: { text: 'Couldn’t stop :6006', source: 'kill 48213: still listening on :6006 after SIGTERM', fix: 'Force stop', agent: 'checkout' },
  failure: { text: 'Can’t read ports', source: 'lsof: unknown option -F', fix: 'Refresh', agent: 'checkout' },
  unattributed: { label: 'Some servers cannot be attributed', note: 'Working directories require a Herdr API on Windows.' },
};
const opened = (name, ports, when, ran, peak, how = null) => ({ name, ports, when, ran, peak, how });
export const sampleRanges = [{ key: 'day', label: '24 h' }, { key: 'week', label: '7 days' }, { key: 'month', label: '30 days' }];
export const samplePortHistory = {
  ranges: sampleRanges,
  bars: [0.3, 0.4, 0.25, 0.5, 0.45, 0.6, 0.35, 0.5, 0.7, 0.55, 0.4, 1, 0.6, 0.45, 0.5, 0.65, 0.4, 0.55, 0.3, 0.5, 0.45, 0.6, 0.4, 0.35],
  part: [0, 0, 0, 0.2, 0, 0, 0, 0.2, 0.3, 0, 0, 0.4, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0.2, 0, 0],
  peak: 11,
  ticks: ['Wed', 'now'],
  most: 'peak 6 at once',
  summary: ['4 stopped by you', '3 left with no pane'],
  lists: [
    { key: 'opened', label: 'Opened today', rows: [opened('storybook', ':6006', 'opened 09:12', 'ran 2 h', '388 MB', 'no pane'), opened('vite', ':5173', 'opened 13:20', 'ran 40 min', '182 MB')], more: 4 },
    { key: 'ended', label: 'Recently ended', rows: [opened('next', ':3002', 'ended 11:40', 'ran 3 h', '240 MB', 'stopped by you')], more: 0 },
  ],
  said: { off: 'No history', bad: 'History unreadable', stale: 'History stopped at 14:02' },
};

export const sampleMarkdown = {
  plan: { file: 'plan.md', folder: '~/acme-shop/docs', source: `# Rate limit checkout per customer

Each customer gets a bucket of 40 requests that refills one token every 2 s. A request over the limit gets 429 and \`wait_s\`, the seconds until the next token.

- Keep the bucket in Redis, keyed by customer id
- Read the limit from \`plans.limits\`
- Log the first 429 per customer per hour

## Tests

\`\`\`
pnpm test src/api/limits.test.ts
\`\`\`` },
  limits: { file: 'limits.md', folder: '~/acme-shop-docs/docs', source: `## Limits by plan

| Plan | Requests | Refill |
|---|---|---|
| Free | 40 | 2 s |
| Team | 200 | 0.5 s |` },
  runbook: { file: 'runbook.md', folder: '~/billing', source: `# Webhook retries

Deliveries retry 5 times with backoff 1, 2, 4, 8, 16 s. A 410 stops them.` },
  events: { file: 'events.md', folder: '~/acme-shop/logs', source: `## Events, 2026-11-10

- 09:14 checkout · 429 for cus_8812
- 09:15 checkout · 429 for cus_8812` },
  agent: 'cart-ui',
  groups: [
    ['Waiting for your review', [['plan.md', 'cart-ui · docs']]],
    ['From this terminal', [['limits.md', '~/acme-shop-docs/docs'], ['notes.md', 'scratchpad']]],
    ['In this folder', [['README.md'], ['CHANGELOG.md'], ['plan.md', 'docs']]],
  ],
  failures: {
    told: { text: 'cart-ui was not told', source: 'md-review: data/markdown-review-done/48213: Permission denied', fix: 'Done', agent: 'cart-ui' },
    save: { text: 'Couldn’t save plan.md', source: 'EACCES: permission denied, write plan.md', fix: 'Save', agent: 'cart-ui' },
  },
};

const container = (name, health, meta, image, ports, age, web = false) => ({ name, health, meta, image, ports, age, web });
export const sampleContainers = {
  cost: { held: '2.1 GB', limit: '7.8 GB', disk: '4.2 GB on disk', stops: 2 },
  projects: [
    { name: 'acme-shop', compose: 'compose.yaml', count: '2 of 3 up', containers: [
      container('api-db', 'failed', 'exited 1 · 3 min', 'postgres:16', ':5432', null),
      container('mailpit', 'running', '31 MB', 'axllent/mailpit', ':8025', 'up 2 h', true),
      container('redis', 'running', '9 MB', 'redis:7-alpine', ':6379', 'up 2 h')] },
    { name: 'docs-site', compose: 'compose.yaml', count: 'not started', containers: [] },
  ],
  loose: [container('buildkit', 'stopped', 'stopped · 2 d', 'moby/buildkit:v0.13', null, null)],
  details: [['Ports', '8025 → 8025/tcp, 1025 → 1025/tcp'], ['Mounts', 'mailpit-data → /data'], ['Networks', 'acme-shop_default'], ['Restarts', 'unless-stopped'], ['Compose', 'compose.yaml · mailpit'], ['Id', '3f9c1a7e20b4']],
  context: { name: 'prod-db', loose: [container('pg-primary', 'running', '1.9 GB', 'postgres:16', ':5432', 'up 9 d'), container('pgbouncer', 'running', '22 MB', 'edoburu/pgbouncer', ':6432', 'up 9 d')] },
  remote: { computer: 'devbox', cost: { held: '3.0 GB', limit: '8 GB', disk: '6.1 GB on disk', stops: 2 }, projects: [{ name: 'relay', compose: 'compose.yaml', count: '2 of 2 up', containers: [
    container('db', 'running', '212 MB', 'postgres:16', ':5432', 'up 1 d'), container('queue', 'running', '48 MB', 'redis:7-alpine', ':6379', 'up 1 d')] }] },
  refused: { text: 'Couldn’t remove api-db', source: 'Error response from daemon: cannot remove container "api-db": container is restarting, stop the container before removing', fix: 'Remove', agent: 'checkout' },
  failure: { text: 'Can’t reach Docker', source: 'docker ps: permission denied while trying to connect to /var/run/docker.sock', fix: 'Refresh', agent: 'checkout' },
  unopened: { text: 'Docker could not be opened from here', source: 'open -a Docker: Unable to find application named Docker', fix: 'Open Docker' },
  unattributed: { label: 'Docker’s memory cannot be attributed', note: 'Docker VM memory attribution requires a Herdr API on Windows.' },
};
const image = (name, size, users, unused = false) => ({ name, size, users, unused });
export const sampleDisk = {
  summary: '9 images 4.2 GB · 1.6 GB unused',
  pull: 'postgres:17',
  spare: '1.6 GB',
  images: [image('postgres:16', '438 MB', 'acme-shop · api-db'), image('node:20-bookworm', '1.1 GB', 'unused · 3 weeks', true), image('axllent/mailpit', '31 MB', 'acme-shop · mailpit')],
  run: { image: 'node:20-bookworm', name: 'web', port: '8080:80' },
  invalid: {
    name: { field: 'name', name: '/web', source: 'Name: letters, digits, _ . or -, starting with a letter or digit.' },
    port: { field: 'port', port: 'http', source: 'Port: a number, or host:container like 8080:80.' },
  },
  volumes: [{ name: 'mailpit-data', users: 'acme-shop · mailpit' }, { name: 'pg-old', users: 'unused' }, { name: 'cache-old', users: 'unused' }],
  unusedVolumes: 2,
  cache: '860 MB',
};

const session = (name, size, state, said, extra = {}) => ({ name, size, state, said, ...extra });
export const sampleMemory = {
  free: { value: '31%', of: 'free of 16 GB', swap: '2.4 GB swap' },
  pageFile: '3.1 GB page file',
  herdr: { size: '1.4 GB', window: '1.1 GB window', core: '210 MB core', limit: 'past its 1.2 GB' },
  helpers: { count: 2, size: '60 MB' },
  sessions: [
    session('checkout', '1.2 GB', 'working', ['Claude', 'working', 'up 3 d']),
    session('docs', '980 MB', 'idle', ['Codex', 'idle 3 h', 'up 2 d', 'past the guard’s 900 MB'], { over: true }),
    session('cart-ui', '760 MB', 'blocked', ['Claude', 'needs you', 'left as it is']),
    session('perf', '720 MB', 'idle', ['Claude', 'idle 2 d', 'up 6 d']),
    session('i18n', '640 MB', 'working', ['Codex', 'working', 'docs-site']),
  ],
  more: 3,
  spark: { bars: [0.2, 0.3, 0.35, 0.5, 0.45, 0.6, 0.7, 0.65, 0.8, 0.9, 1, 0.95], spoken: 'Memory rising from 420 MB to 980 MB' },
  unrecyclable: 'No conversation to resume',
  bulk: { idle: '2 idle', back: 'about 1.7 GB back', heavy: 'Only the 1 over 500 MB', unused: 'Close the 1 not used for 2 days · 720 MB' },
  batch: { done: [['checkout', '1.6 GB → 210 MB'], ['perf', '720 MB → 180 MB']], current: 'docs', said: 'Recycled 2 of 2 · 1.9 GB back' },
  guard: [['Recycle idle agents past 900 MB', true], ['Restart the window past 1.2 GB', true], ['Notify under 20% free', true]],
  history: {
    ranges: sampleRanges,
    bars: [0.6, 0.55, 0.5, 0.52, 0.45, 0.4, 0.3, 0.2, 0.12, 0.08, 0.15, 0.3, 0.45, 0.5, 0.55, 0.5, 0.48, 0.52, 0.55, 0.58, 0.5, 0.45, 0.4, 0.31],
    low: [8, 9, 10],
    ticks: ['yesterday 15:00', 'now'],
    most: 'lowest 8% · 11:20',
    summary: ['6 recycles', '1 closed', '1 restart', '2.3 GB freed'],
    lists: [
      { key: 'events', label: 'Events', rows: [['docs recycled: 1.4 GB to 190 MB', '11:24'], ['Memory low: 8% free', '11:20'], ['cart-ui not recycled: it needs you', '09:02', true], ['Window restarted past 1.2 GB', '08:41']], more: 0 },
      { key: 'heaviest', label: 'Heaviest', rows: [['Docker VM', '2.1 GB'], ['Herdr window', '1.1 GB'], ['Safari', '940 MB']], more: 0 },
    ],
  },
  refused: { text: 'Couldn’t recycle docs', source: 'docs: its terminal did not take the restart', fix: 'Recycle', agent: 'docs' },
  reap: { text: 'Couldn’t end 2 hung helpers', source: 'kill: (4121) - Operation not permitted', fix: 'End', agent: 'checkout' },
  install: { text: 'Couldn’t turn on the memory guard', source: 'launchctl bootstrap: 5: Input/output error', fix: 'Turn on', agent: 'checkout' },
  unreadable: { text: 'Can’t read the memory guard', source: 'guard.json: Unexpected end of JSON input', fix: 'Turn on', agent: 'checkout' },
  stale: 'Stopped at 14:02',
  stuck: { text: 'Couldn’t restart the window', source: 'The window did not stop; it was not reopened.', fix: 'Restart window', agent: 'checkout' },
  pausedWhy: '3 restarts in the last hour. Automatic restarts are paused for an hour.',
  silent: 'The guard stopped answering',
  remote: { computer: 'devbox', free: { value: '54%', of: 'free of 32 GB', swap: '0 swap' }, herdr: { size: '320 MB' }, sessions: [session('relay', '1.1 GB', 'working', ['Claude', 'working', 'up 1 d'])] },
};
const notice = (state, text, detail) => ({ state, home: 'memory', text, detail });
export const sampleMemoryNotices = {
  'Recycled': notice('done', 'docs restarted', 'It held 1400 MB; the same conversation goes on in a fresh process (190 MB).'),
  'Batch': notice('done', 'Agents recycled', '3 of 3, 2100 MB freed. Same conversations, fresh processes.'),
  'Did not resume': notice('failed', 'docs did not resume', 'Run in its terminal: codex resume 0199a4'),
  'Terminal busy': notice('waits', 'docs needs a manual restart', 'It exited, but its terminal is busy. Run: codex resume 0199a4'),
  'Restart needed': notice('waits', 'perf needs a manual restart', 'Run in its terminal: claude --resume 7f3e'),
  'Restart scheduled': notice('fact', 'Herdr will restart its window', 'Past its 1.2 GB. It restarts when you pause for a minute; terminals keep running.'),
  'Window restarted': notice('done', 'Herdr window restarted', 'Past its 1.2 GB. Your terminals and agents kept running.'),
  'Restart loop': notice('failed', 'Herdr keeps outgrowing its limit', 'Automatic restarts are paused for an hour. Open Memory in kansō to see what grows.'),
};

const plan = (value, name, said, tone = '') => ({ value, name, said, tone });
const spent = (name, cost, said, extra = {}) => ({ name, cost, said, ...extra });
const dollars = (amount) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const perDay = (costs) => {
  const top = Math.max(...costs);
  const peak = top ? costs.indexOf(top) : null;
  return {
    bars: costs.map((cost) => (top ? cost / top : 0)), peak, labels: costs.map((cost, day) => (day === peak ? dollars(cost) : '')),
    said: costs.map((cost, day) => `Nov ${day + 1} · ${dollars(cost)} · ${Math.round(cost * 24000).toLocaleString('en-US')} tokens`),
    spoken: 'API value per day', ticks: ['Nov 1', 'Per day', `Nov ${costs.length}`],
  };
};
export const sampleSpend = {
  month: 'November',
  plans: [plan('25×', 'Claude Max 20x', '$5,012 of work for $200'), plan('3.1×', 'ChatGPT Plus', '$62 of work for $20')],
  under: plan('0.3×', 'ChatGPT Pro', '$61 of work for $200 · not paying for itself', 'working'),
  early: plan('24×', 'Claude Max 20x · too early to say', 'on pace: $322 in 2 days, about $4,800 by November 30', 'dim'),
  periods: [{ key: 'day', label: 'Today' }, { key: 'month', label: 'Month' }, { key: '30d', label: '30 days' }, { key: 'year', label: 'Year' }, { key: 'all', label: 'All time' }],
  today: { value: '$41.20', unit: 'today', said: ['14 tasks', '$2.94 a task', '9.1M tokens'] },
  nothing: { value: '$0.00', unit: 'November', said: ['0 tasks', '0 tokens'] },
  past: { value: '$824.00', unit: 'October', said: ['212 tasks', '$3.89 a task', '140M tokens'] },
  lists: {
    projects: [spent('acme-shop', '$28.40', '6.2M tokens · ~/acme-shop'), spent('docs-site', '$9.10', '2.1M tokens · ~/docs-site'), spent('reports', '$3.70', '0.8M tokens · ~/reports')],
    models: [spent('claude-opus-5', '$34.90', 'Anthropic · $15 in / $75 out per 1M'), spent('gpt-5-codex', '$6.30', 'OpenAI · $1.25 in / $10 out per 1M')],
    tasks: [spent('Rate limit checkout per customer', '$12.80', 'acme-shop · claude-opus-5 · 2 sessions'), spent('Fix the refill test after review', '$6.40', 'acme-shop · claude-opus-5', { tag: `PR ${pullRequest(142)}` }), spent('Add the countdown to the cart', '$4.70', 'acme-shop · claude-opus-5')],
  },
  more: 4,
  choices: { project: 'All projects', model: 'All models' },
  chooser: [{ label: 'All projects', checked: true }, { label: 'acme-shop', second: '~/acme-shop', hint: '$28.40', checked: false }, { label: 'docs-site', second: '~/docs-site', hint: '$9.10' }, { label: 'reports', second: '~/reports', hint: '$3.70' }],
  showing: 'Showing acme-shop and claude-opus-5',
  filtered: {
    choices: { project: 'acme-shop', model: 'claude-opus-5' }, number: { value: '$23.90', unit: 'today', said: ['3 tasks', '$7.97 a task', '5.1M tokens'] },
    lists: { projects: [spent('acme-shop', '$23.90', '5.1M tokens · ~/acme-shop')] },
  },
  live: [spent('Rate limit checkout per customer', '$3.10', 'acme-shop · claude-opus-5 · 1.2M tok'), spent('Translate the pricing page', '$0.90', 'docs-site · gpt-5-codex · 310K tok')],
  history: perDay([2.25, 12.15, 0, 30.15, 45, 0, 8.1, 18, 0, 4.95, 0, 9.9, 41.2]),
  quiet: { ...perDay(Array(13).fill(0)), none: 'No usage in November' },
  partial: 'Still reading your history: 412 of 1,980 files so far.',
  reading: 'Reading sessions · 412 of 1,980',
  project: { days: perDay([0, 8, 0, 21, 30, 0, 6, 12, 0, 0, 0, 7, 28.4]), name: 'acme-shop', value: '$28.40', said: ['8 tasks', '$3.55 a task', '6.2M tokens'], models: [spent('claude-opus-5', '$25.90', '5.8M tokens'), spent('claude-haiku-5', '$2.50', '0.4M tokens')] },
  model: { name: 'claude-opus-5', value: '$34.90', said: ['11 tasks', '$3.17 a task', '7.4M tokens'], projects: [spent('acme-shop', '$25.90', '5.8M tokens'), spent('docs-site', '$9.00', '1.6M tokens')] },
  task: {
    where: 'acme-shop · Today, 09:12 – 13:40', prompt: 'Rate limit checkout per customer, 40 a minute, with Retry-After', value: '$12.80',
    parts: ['in 3.1M', 'out 180K', 'cache read 22M', 'cache write 1.4M'],
    models: [spent('claude-opus-5', '$12.10', '25M tokens'), spent('claude-haiku-5', '$0.70', '1.6M tokens')],
    sessions: [spent('checkout', '$9.60', '09:12'), spent('checkout', '$3.20', '12:58')], count: '2',
    days: perDay([0, 0, 0, 12, 20, 0, 3, 8, 0, 0, 0, 2, 12.8]),
  },
  plain: { value: '$353', unit: 'paid as used in November', programs: [spent('Codex', '$312', 'API key'), spent('Pi', '$41', 'API key')] },
  computers: { count: '2 computers', rows: [spent('This computer', '$3,900', '96M tokens'), spent('devbox', '$1,112', '31M tokens')] },
  away: spent('build', '$0', null, { tag: { text: 'unreachable · read 11:02', tone: 'blocked' } }),
  unread: { program: spent('Codex', '$62', ''), failure: { text: 'Can’t read the Codex plan', source: '~/.codex/auth.json: EACCES: permission denied', fix: 'Refresh', agent: 'checkout' } },
  failure: { text: 'Can’t read spend', source: 'spawn /opt/homebrew/bin/node ENOENT', fix: 'Refresh', agent: 'checkout' },
  refresh: { text: 'Last update failed', source: 'collector.mjs: database is locked', fix: 'Refresh', agent: 'checkout' },
  runtime: { text: 'Spend can’t run', source: 'Spend needs runtime.json with the path to Node 22: node not found', fix: 'Refresh', agent: 'checkout' },
  sources: [
    { name: 'Claude Code', where: '~/.claude/projects · 1,240 sessions', on: true },
    { name: 'Codex', where: '~/.codex/sessions · 310 sessions', on: true },
    { name: 'Grok', where: '~/.grok/sessions · 64 sessions', on: false },
  ],
  absent: 'Pi not on this computer',
  owned: [spent('Claude Max 20x', '$200 a month', 'detected'), spent('ChatGPT Plus', '$20 a month', 'detected'), spent('SuperGrok Plus', 'no price', 'detected · not in the price list')],
  corrected: { name: 'SuperGrok Plus', cost: '$30', said: 'detected · a month, your price' },
  prices: { list: 'OpenRouter list, Nov 10', rule: 'Tokens with no list price are left out, not guessed.' },
  updates: { name: 'Every minute while open', said: 'Every 30 s while a session works; closed, nothing.' },
  invalid: { price: '0', rule: 'A plan needs a name and a price over $0' },
  unsaved: { text: 'Couldn’t save the plans', source: 'prices.json: EACCES: permission denied', fix: 'Save again', agent: 'checkout' },
};
const amount = (cost) => Number(cost.slice(1));
const scaled = (factor) => (item) => ({ ...item, cost: dollars(amount(item.cost) * factor) });
const over = (factor, unit, said) => ({
  number: { value: dollars(amount(sampleSpend.today.value) * factor), unit, said },
  lists: Object.fromEntries(Object.entries(sampleSpend.lists).map(([view, rows]) => [view, rows.map(scaled(factor))])),
});
export const sampleSpendSpans = {
  month: over(20, 'this month', ['280 tasks', '$2.94 a task', '182M tokens']),
  '30d': over(30, 'over 30 days', ['420 tasks', '$2.94 a task', '273M tokens']),
  year: over(240, 'this year', ['3,360 tasks', '$2.94 a task', '2.2B tokens']),
  all: over(360, 'all time', ['5,040 tasks', '$2.94 a task', '3.3B tokens']),
};

export const samplePreview = {
  code: { file: 'limits.ts', folder: 'src/api', text: { kind: 'source', first: 1, text: `import { planOf } from "./plans";

const LIMIT = { free: 40, pro: 400 };
const REFILL_MS = 2000;

export function bucket(customer) {
  const plan = planOf(customer);
  return { plan, tokens: LIMIT[plan] };
}

export function retryAfter(b) {
  const missing = 1 - b.tokens;
  return missing * REFILL_MS;
}` } },
  edit: { line: 4, from: 'REFILL_MS = 2000', to: 'REFILL_MS = 1000' },
  markdown: { file: 'limits.md', folder: 'docs', source: `# Rate limits

Each customer gets a bucket of requests. A request takes one token; the bucket refills one token every 2 s.

| Plan | Per minute | Burst |
|---|---|---|
| Free | 40 | 10 |
| Pro | 400 | 60 |

## Retry-After

An empty bucket answers \`429\` with \`Retry-After\` in seconds.` },
  log: { file: 'api.log', folder: 'logs', text: { kind: 'log', first: 1, text: `14:02:11 POST /checkout 200 41ms
14:02:11 POST /checkout 200 38ms
14:02:12 POST /checkout 429 2ms
14:02:12 POST /checkout 429 1ms
14:02:14 POST /checkout 200 44ms` } },
  pictured: `## What the customer sees

![checkout-429](shots/checkout-429.png)

The countdown comes from \`Retry-After\`.`,
  shot: { file: 'checkout-429.png', folder: 'docs/shots', size: '4.2 MB' },
  huge: { file: 'walkthrough.gif', folder: 'docs/shots' },
  pins: [{ n: 1, at: [56, 41], text: '429 should be the reason, not the code' }, { n: 2, region: [30, 58, 34, 7], text: 'Say “2 seconds”', writing: [33, 68] }],
  binary: { file: 'limiter.wasm', folder: 'build' },
  gone: { file: 'limits.old.ts', folder: 'src/api' },
  failures: {
    read: { text: 'Can’t read limits.ts', source: 'EACCES: permission denied, open \'src/api/limits.ts\'', fix: 'Refresh', agent: 'checkout' },
    save: { text: 'Couldn’t save limits.ts', source: 'EACCES: permission denied, write \'src/api/limits.ts\'', fix: 'Save', agent: 'checkout' },
    picture: { text: 'Can’t show checkout-429.png', source: 'Cannot show this picture', fix: 'Refresh', agent: 'checkout' },
  },
};
const pull = (number, title, state, extra = {}) => ({ number, title, state, ...extra });
export const samplePulls = {
  asked: [pull('#44', 'Batch webhook retries', 'review'), pull('#91', 'Round tax per line, not per order', 'failing'), pull(`${pullRequest(3127)}`, 'Stream large uploads to disk', 'running')],
  projects: [
    { name: 'acme-shop', everyone: 'Everyone’s in acme-shop', pulls: [pull(`${pullRequest(142)}`, 'Rate limit checkout per customer', 'failed'), pull(`${pullRequest(143)}`, 'Show the retry time in the cart', 'failed'), pull(`${pullRequest(140)}`, 'Move the limits to Redis', 'blocked')] },
    { name: 'relay', pulls: [pull('#42', 'Make webhook delivery safe to retry', 'changes')] },
    { name: 'docs-site', pulls: [pull(`${pullRequest(145)}`, 'Translate the limits page', 'draft')] },
    { name: 'herdr-app', pulls: [pull(`${pullRequest(575)}`, 'Recycle the mod runtime before it runs out of memory', 'approved')] },
  ],
  branches: {
    none: { name: 'rate-limit', second: 'No pull request · 4 commits on GitHub', action: 'Create pull request' },
    unpushed: { name: 'limiter-tests', second: '2 commits not on GitHub', action: 'Push', commits: ['Handle empty checkout buckets', 'Add retry headers'] },
    behind: { name: 'limits-redis-2', computer: 'devbox', second: '3 commits behind GitHub', action: 'Pull' },
    merged: { name: 'plan-cache', second: `No pull request · ${pullRequest(139)} merged 14:20`, action: 'Create pull request' },
    detached: { name: 'HEAD at 4e1a2b0', second: 'No branch checked out' },
    noRemote: { name: 'checkout-v2', second: 'No remote' },
    elsewhere: { name: 'checkout-v2', second: 'No GitHub remote · git@gitlab.com:acme/shop.git' },
  },
  closed: [pull(`${pullRequest(142)}`, 'Rate limit checkout per customer', 'merged', { second: 'checkout-v2 → main' }), pull(`${pullRequest(141)}`, 'Document retry headers', 'closed', { second: 'docs-retry → main' })],
  others: [[`${pullRequest(140)}`, 'Add tax receipts'], [`${pullRequest(139)}`, 'Fix rounding'], [`${pullRequest(138)}`, 'Update customer email'], [`${pullRequest(137)}`, 'Handle refunds']].map(([number, title]) => pull(number, title, 'review', { second: 'Review required' })),
  counts: { open: 'Open 12', closed: 'Closed', others: 'Other open pull requests · 12' },
  stale: { limited: 'Read 14:02 · GitHub limited until 14:30', silent: 'Read 14:02 · GitHub not answering · next try 14:07' },
  contexts: {
    signIn: { icon: 'lu-git-pull-request', text: 'Not signed in to GitHub', action: 'Sign in' },
    cli: { icon: 'lu-git-pull-request', text: 'GitHub CLI not installed', action: 'cli.github.com' },
    nothing: { icon: 'lu-git-pull-request', text: 'Nothing open' },
    nothingElse: { icon: 'lu-git-pull-request', text: 'Nothing else open' },
    nothingClosed: { icon: 'lu-git-pull-request', text: 'Nothing closed yet' },
  },
  keep: { text: 'Could not keep pull requests', source: 'EACCES: permission denied writing the local cache', fix: 'Refresh' },
};
const check = (name, state, time = null) => ({ name, state, time });
const said = (who, when, text, extra = {}) => ({ who, when, text, ...extra });
export const samplePull = {
  number: `${pullRequest(142)}`, title: 'Rate limit checkout per customer', branch: 'acme-shop · checkout-v2 → main', agent: 'checkout',
  verdicts: {
    failed: { text: 'test / unit failed', tone: 'blocked', log: 'AssertionError: expected 39 to be 40\n ❯ src/api/limits.test.ts:42:18' },
    ready: { text: 'Ready to merge', tone: 'done', facts: '2 approvals · 5 checks passed' },
    draft: { number: `${pullRequest(145)}`, title: 'Translate the limits page', text: 'Draft · 1 check running', tone: 'dim', checks: [check('build / i18n', 'running', '1m 20s')] },
    running: { text: 'Checks running · 3 of 5', tone: 'dim', checks: [check('test / e2e', 'running', '4m 10s'), check('deploy / preview', 'running', '1m 02s')] },
    deciding: { number: `${pullRequest(141)}`, title: 'Document the rate limit per plan', text: 'Checking whether it can merge', tone: 'dim' },
    conflicts: { number: '#88', title: 'Apply tax rates per region', agent: 'billing', text: 'Conflicts with main', tone: 'blocked', heading: '2 files conflict with main', files: 'src/tax/rates.ts\nsrc/tax/regions.ts' },
    behind: { number: '#57', title: 'Fuzzy search for products', agent: 'search', text: 'Behind main by 4', tone: 'working', heading: 'main has 4 commits this branch lacks', lines: [['a41c2e9', `Cache the plan lookup (${pullRequest(139)})`], ['7be01d3', `Rate limit checkout (${pullRequest(142)})`], ['c09f8aa', 'Bump vitest to 3.2']], more: 'and 1 more' },
    rules: { number: `${pullRequest(140)}`, title: 'Move the limits to Redis', text: 'Blocked by branch rules', tone: 'working', heading: 'main requires', lines: [['Approvals', '1 of 2'], ['Checks', 'test / e2e has not run'], ['Commits', 'signed: 2 of 4 are not']] },
    review: { number: `${pullRequest(146)}`, title: 'Round Retry-After up to whole seconds', text: 'Review required', tone: 'working', heading: 'Asked 1h ago', lines: [['sam', 'no review yet'], ['lee', 'no review yet']] },
    permission: { number: `${pullRequest(575)}`, title: 'Recycle the mod runtime before it runs out of memory', text: 'No permission to merge', tone: 'dim', lines: [['You', 'read; merging needs write'], ['Can merge', 'ogulcan and mira, who approved']] },
    unfinished: { text: '3 checks did not finish', tone: 'blocked', lines: [['deploy / preview', 'cancelled by a newer push'], ['test / e2e', 'timed out after 30 min'], ['build / docs', 'waiting for approval to run']] },
    waits: { number: `${pullRequest(143)}`, title: 'Show the retry time in the cart', text: 'test / e2e failed · cart-ui needs you first', tone: 'blocked', log: '✘ cart.spec.ts:18 shows the wait\n  Expected "Try again in 2 s"\n  Received "Try again in NaN s"' },
    changes: { number: '#42', title: 'Make webhook delivery safe to retry', agent: 'webhooks', text: 'Changes requested', tone: 'blocked', lines: [['sam', 'src/webhooks/deliver.ts:6'], ['Cover a timeout after the receiver accepts the event.']], threads: '+1 more thread' },
    closed: { text: 'Closed', tone: 'dim' },
  },
  refusals: {
    explain: { text: 'Couldn’t explain to webhooks', source: 'hc send: webhooks closed its prompt', fix: 'Explain to webhooks' },
    merge: { text: 'Merge refused', source: 'gh: Base branch was modified. Review and try the merge again.', fix: 'Squash and merge', agent: 'docs' },
    unreachable: { text: 'Couldn’t explain to checkout', source: 'ssh: connect to host devbox port 22: Operation timed out', fix: 'Explain to checkout' },
    reply: { text: 'Reply not posted', source: 'gh: Could not resolve to a node with the global id of PRRT_kwDOK1', fix: 'Reply' },
    diff: { text: 'Could not read the diff', source: 'gh: HTTP 502: Bad Gateway', fix: 'Refresh' },
    reviewer: { text: 'Couldn’t ask sloane to review', source: 'gh: HTTP 422: Reviews may only be requested from collaborators', fix: 'Request review' },
  },
  sent: 'Sent to checkout 14:07',
  thread: {
    where: 'src/api/limits.ts:12', snippet: { kind: 'source', first: 11, line: 12, text: 'export function bucket(customer) {\n  const plan = planOf(customer);\n  return { plan, tokens: LIMIT[plan] };' },
    first: said('lee', '2h', 'Should the bucket key include the plan? A customer who upgrades keeps the old limit until the bucket expires.'),
    replies: [said('jj', '40m', 'Good catch. The key becomes customer and plan; an upgrade starts a fresh bucket.')],
  },
  answers: {
    answer: said('jj', 'now', 'Done in 4e1a2b0: the bucket key is now customer and plan.', { pending: true }),
    agentAnswer: 'Covered in 9c2d1e4: a timeout after acceptance now retries with the same idempotency key, and deliver.test.ts checks that the receiver sees it once.',
    answered: 'webhooks answered 14:21',
  },
  events: { approved: { name: 'sam approved', meta: '1h' }, comment: said('sam', '1h', 'Fine once test / unit passes.'), mine: { name: 'You approved, with 2 line comments', detail: 'sending to GitHub', meta: 'now', pending: true }, resolved: { name: 'Resolved: lee', detail: 'limits.ts:12' }, offline: 'Read 14:02 · GitHub not answering. 1 reply waits.' },
  details: {
    summary: '5 checks · 3 people · 3 files',
    description: `Limits POST /checkout per customer with a token bucket: 40 a minute on Free, 400 on Pro. An empty bucket answers 429 with Retry-After.\n\nThe bucket lives in memory for now; ${pullRequest(140)} moves it to Redis.`,
    people: [['Assignees', 'jj'], ['Reviewers', 'lee approved · sam asked'], ['Labels', 'api · rate-limit']],
    checks: [check('test / unit', 'failed'), check('test / e2e', 'passed', '4m 10s'), check('lint', 'passed', '38s'), check('typecheck', 'passed', '51s'), check('deploy / preview', 'passed', '1m 02s')],
    files: [{ letter: 'M', name: 'checkout.ts', folder: 'src/api', stat: '+14 −3' }, { letter: 'A', name: 'limits.ts', folder: 'src/api', stat: '+22' }, { letter: 'M', name: 'limits.test.ts', folder: 'src/api', stat: '+6 −4' }],
    cut: { more: 'Show 92 more', note: 'GitHub lists the first 100 of 140 files.' },
    moreChecks: 'Show 3 more',
  },
  review: { number: '#44', title: 'Batch webhook retries', text: 'Review required · asked of you', tone: 'working', count: '2 line comments', draft: 'Batching looks right. Two notes on the backoff inline.', changed: [{ letter: 'M', name: 'retry.ts', folder: 'src/webhooks', stat: '+52 −9' }, { letter: 'A', name: 'batch.test.ts', folder: 'src/webhooks', stat: '+12' }] },
  message: { text: 'sam  src/webhooks/deliver.ts:6\nCover a timeout after the receiver accepts the event.\nhttps://github.com/acme/relay/pull/42' },
  remote: { computer: 'devbox', stale: 'devbox unreachable · Read 14:02' },
};
export const samplePullPages = {
  diff: { file: 'checkout.ts', facts: `${pullRequest(142)} · src/api · +14 −3`, text: { kind: 'diff', first: 18, text: '@@ -18,7 +18,14 @@ checkout(req, res)\n const customer = req.user.id;\n+const b = bucket(customer);\n+if (b.tokens < 1) {\n+  res.set("Retry-After", retryAfter(b));\n+  return res.status(429).end();\n+}\n const cart = await carts.get(customer);\n-await charge(cart);\n+await charge(cart, { key: req.id });\n return res.json({ ok: true });' } },
  commented: { text: 'Round up here, or a client retries a second early', chunks: [
    { kind: 'diff', first: 18, line: 21, text: ' const customer = req.user.id;\n+const b = bucket(customer);\n+if (b.tokens < 1) {\n+  res.set("Retry-After", retryAfter(b));' },
    { kind: 'diff', first: 22, text: '+  return res.status(429).end();\n+}' }] },
  pointed: { kind: 'diff', first: 18, line: 21, comment: 21, text: ' const customer = req.user.id;\n+const b = bucket(customer);\n+if (b.tokens < 1) {\n+  res.set("Retry-After", retryAfter(b));\n+  return res.status(429).end();\n+}' },
  pending: { file: 'retry.ts', facts: '#44 · src/webhooks · +52 −9 · 1 pending', chunks: [{ kind: 'diff', first: 38, line: 39, text: ' for (const batch of chunks(due, 50)) {\n+  await sleep(backoff(attempt));' }, { kind: 'diff', first: 40, line: 40, text: '+  await Promise.all(batch.map(retry));' }, { kind: 'diff', first: 41, text: ' }' }], note: { who: 'jj', when: 'now', text: 'Cap the backoff; at attempt 12 this waits an hour.' }, draft: 'One failing receiver holds the whole batch back' },
  threaded: { file: 'limits.ts', facts: `${pullRequest(142)} · src/api · +22`, chunks: [{ kind: 'diff', first: 11, line: 12, text: '+export function bucket(customer) {\n+  const plan = planOf(customer);' }, { kind: 'diff', first: 13, text: '+  return { plan, tokens: LIMIT[plan] };' }], note: { who: 'lee', when: '2h', text: 'Should the bucket key include the plan?' }, replies: '1 reply' },
  long: { file: 'pnpm-lock.yaml', facts: `${pullRequest(142)} · +1,240 −312 · lines 1 to 400`, text: { kind: 'diff', first: 392, text: '+/retry-after@1.2.0:\n+  resolution: {integrity: sha512-…}\n+  engines: {node: \'>=18\'}\n \n-/rollup@4.21.0:\n+/rollup@4.22.4:\n   resolution: {integrity: sha512-…}\n   hasBin: true\n+  optionalDependencies:\n+    fsevents: 2.3.3' }, more: '1,152 more lines', next: 'Show the next 400' },
  reading: { file: 'limits.test.ts', facts: `${pullRequest(142)} · src/api · +6 −4` },
  picture: { file: 'checkout-429.png', facts: `${pullRequest(142)} · docs/shots · added`, empty: { icon: 'lu-file', text: 'No text diff' } },
  log: { file: 'test / unit', facts: `${pullRequest(142)} · Run pnpm test · 1m 48s · 38 lines`, text: { kind: 'log', first: 1, text: ' RUN  v3.2.0 /work/acme-shop\n ✓ src/api/checkout.test.ts (9 tests) 41ms\n ✓ src/api/plans.test.ts (6 tests) 12ms\n FAIL  src/api/limits.test.ts > refills after 2 s\nAssertionError: expected 39 to be 40\n ❯ src/api/limits.test.ts:42:18\n    40|   vi.advanceTimersByTime(2000)\n    41|   const b = bucket("c1")\n  > 42|   expect(b.tokens).toBe(40)\n Test Files  1 failed | 11 passed (12)\n      Tests  1 failed | 47 passed (48)\n##[error]Process completed with exit code 1.' } },
  refused: { text: 'Could not create it', source: 'gh: GraphQL: No commits between main and rate-limit', fix: 'Create on GitHub' },
  create: { facts: 'acme-shop · rate-limit → main · 4 commits', title: 'Rate limit checkout per customer', body: 'Limits POST /checkout per customer with a token bucket.' },
  me: { name: 'jj', second: 'JJ' },
  people: [{ name: 'sam', second: 'Sam Ortiz' }, { name: 'sloane', second: 'Sloane Park' }, { name: 'stan', second: 'Stan Ruiz' }, { name: 'lee', second: 'Lee Chen' }],
  labels: [{ name: 'api', dot: 'blue' }, { name: 'rate-limit', dot: 'violet' }, { name: 'bug', second: 'Something isn’t working', dot: 'blocked' }, { name: 'docs', dot: 'working' }],
  notes: { first: 'First 100 of 132', none: 'Nobody with access matches', offline: 'GitHub not answering. 2 changes wait.', noLabels: 'This repository has no labels', truncated: 'More people have access than are listed here' },
};

const tree = (name, size, verdict, extra = {}) => ({ name, size, verdict, path: `~/.kanso/worktrees/acme-shop/${name}`, ...extra });
const kept = (text) => ({ text });
const loses = (text) => ({ text, tone: 'blocked' });
const worktreeVerdicts = {
  changes: tree('promo-banner', '380 MB', loses('2 uncommitted changes'), { age: '6d', reason: loses('Loses src/web/Banner.tsx and src/web/promo.css, not committed.') }),
  open: tree('acme-shop-cart', '310 MB', { text: 'In a tab: cart-ui', tone: 'working' }, { kind: 'open', branch: 'cart-retry', age: 'today', tab: 'cart-ui', path: '~/acme-shop-cart' }),
  broken: tree('checkout-spike', '96 MB', { text: 'Its link to acme-shop is broken', tone: 'working' }, { kind: 'broken' }),
  merged: tree('rate-limit-v1', '412 MB', kept('Merged'), { age: '3d', reason: kept('Nothing is lost. Branch rate-limit-v1 goes too: its work is in develop.') }),
  unmerged: tree('old-cart', '290 MB', kept('Not merged, 3 commits stay on its branch'), { age: '12d', reason: kept('Nothing is lost. Branch old-cart stays with its 3 commits.') }),
  detached: tree('a82f9c1', '180 MB', kept('Detached, its commits are on branches'), { age: '9d', reason: kept('Nothing is lost.') }),
  lost: tree('a17e0d4', '210 MB', loses('2 commits only here'), { age: '4d', reason: loses('Loses 2 commits no branch has.') }),
  locked: tree('release-2-4', '520 MB', kept('Locked'), { kind: 'held', branch: 'release/2.4', reason: kept('Run git worktree unlock to remove it.') }),
  recent: tree('search-facets', '240 MB', { text: 'In use today', tone: 'working' }, { age: 'today', reason: kept('Nothing is lost. Branch search-facets stays. Clean up and Remove all leave it alone.') }),
  checking: tree('cart-retry-2', '300 MB', kept('Checking'), { kind: 'held', reason: kept('As the last scan saw it. Checking it again before it can be removed.') }),
  missing: tree('feat-banner', '', kept('Folder gone'), { kind: 'record', reason: kept('Its folder is already gone; only git’s record of it is removed.') }),
  replaced: tree('docs-v2', '', kept('Folder reused'), { kind: 'record', reason: kept('Its folder is now a repository of its own and stays as it is; only the old worktree record is removed.') }),
  orphan: tree('billing-tax', '640 MB', kept('Its repository moved or was deleted'), { path: '~/.kanso/worktrees/billing/billing-tax', reason: loses('The folder is deleted. Its repository moved or was deleted, so git cannot say what is in it.') }),
};
const repo = (name, size, rows, extra = {}) => ({ name, size, rows, ...extra });
const { open, changes, merged, unmerged, orphan } = worktreeVerdicts;
const relayHotfix = { ...merged, name: 'relay-hotfix', size: '120 MB', age: '9d', reason: kept('Nothing is lost. Branch relay-hotfix goes too: its work is in main.') };
export const sampleWorktrees = {
  verdicts: worktreeVerdicts,
  total: { value: '2.4 GB', unit: 'in 9 worktrees', narrow: 'in 9' },
  plan: { count: 3, size: '1.1 GB', names: 'rate-limit-v1, relay-hotfix and one more. Merged branches go too.' },
  space: ['Scanned 14:02', '3 can go, 1.1 GB', '1 needs a look, 380 MB', '1 in use, 310 MB', '1 left behind, 640 MB'],
  split: [['Can go, losing nothing · 3', '1.1 GB · 45%'], ['Need a look · 2', '380 MB · 16%'], ['In use or open · 2', '310 MB · 13%'], ['Left behind · 1', '520 MB · 21%'], ['Still checking · 1', '120 MB · 5%']],
  repos: [
    repo('acme-shop', '1.6 GB', [open, changes, merged, unmerged], { more: 2, all: 3, losses: loses('Loses 2 uncommitted changes in promo-banner. Merged branches go too.') }),
    repo('relay', '120 MB', [relayHotfix], { losses: kept('Nothing is lost. Merged branches go too.') }),
  ],
  left: repo('Left behind', '640 MB', [orphan], { prune: 'Prune 2 records of folders already gone' }),
  many: [repo('billing', '210 MB', [{ ...merged, name: 'tax-rates-v2', size: '210 MB' }]), repo('search', '96 MB', [{ ...unmerged, name: 'fuzzy-old', size: '96 MB' }])],
  hidden: 3,
  relay: repo('relay', '320 MB', [relayHotfix, { ...relayHotfix, name: 'relay-batch-old', size: '200 MB' }], { all: 2, losses: kept('Nothing is lost. Merged branches go too.') }),
  freed: {
    fold: { name: 'Freed since 2 Oct', meta: '12.4 GB' },
    ranges: [{ key: 'freed', label: 'Freed' }, { key: 'held', label: 'On disk' }],
    most: 'best 3.1 GB · Oct 28',
    bars: [0, 0.1, 0, 0, 0.4, 0, 0.05, 0, 0, 0.2, 0, 0, 0, 0.6, 0, 0, 0.1, 0, 0, 0, 0.3, 1, 0, 0, 0.15, 0, 0, 0.25, 0, 0.05],
    peak: 21,
    ticks: ['Oct 15', 'Today'],
    summary: ['31 removed', '12 branches deleted', '4 leftovers', '1.2 GB outside kansō'],
  },
  held: { most: 'most 3.4 GB · Nov 2', bars: [0.5, 0.52, 0.55, 0.6, 0.62, 0.7, 0.68, 0.75, 0.8, 0.85, 1, 0.9, 0.7, 0.72, 0.74, 0.7, 0.68, 0.71, 0.73, 0.75, 0.7, 0.72, 0.74, 0.7, 0.68, 0.7, 0.72, 0.71, 0.7, 0.71], peak: 10 },
  never: { fold: { name: 'Freed', meta: null }, summary: ['Nothing freed yet'] },
  phases: { first: 'Reading 14 repositories', checking: 'Checking 12 of 40', cleaning: 'Removing 2 of 3' },
  failure: { text: 'Can’t list worktrees', source: 'git worktree list: timed out after 30 s', fix: 'Refresh', agent: 'checkout' },
  refused: { text: 'Couldn’t remove old-cart', source: 'git: ‘old-cart’ contains modified or untracked files, use --force to delete it', fix: 'Remove', agent: 'checkout' },
  several: { text: '2 not removed', source: 'feat-banner: It is a worktree again; refresh', fix: 'Refresh', agent: 'checkout' },
  repair: { text: 'Can’t repair checkout-spike', source: 'git still can’t read it', fix: 'Repair the link', agent: 'checkout' },
  unread: { text: 'Can’t read the history', source: 'SQLITE_READONLY: attempt to write a readonly database', fix: 'Refresh', agent: 'checkout' },
  noSqlite: { text: 'Can’t keep the history', source: 'sqlite3 not found: install it to keep what was freed', fix: 'Refresh', agent: 'checkout' },
  stayed: 'old-cart changed since you looked, so it stays. Its row shows it as it is now.',
  creating: {
    project: 'acme-shop', branch: 'rate-limit-v2', place: '~/.kanso/worktrees/acme-shop/rate-limit-v2', agent: 'checkout',
    opens: { items: [{ key: 'claude', label: 'Claude', icon: 'p-claude' }, { key: 'codex', label: 'Codex', icon: 'p-codex' }, { key: 'terminal', label: 'Terminal' }], value: 'claude' },
  },
  taken: { branch: 'cart-retry', refused: '\'cart-retry\' is already checked out at ~/acme-shop-cart' },
  remote: { scope: 'Read 13:52 · devbox unreachable · next try 14:04', total: { value: '5.1 GB', unit: 'in 6 worktrees' }, plan: { count: 2, size: '2.2 GB' }, repos: [repo('acme-shop', '3.4 GB', [])] },
};
const worktreeNotice = (state, text, detail) => ({ state, home: 'worktrees', text, detail });
export const sampleWorktreeNotices = {
  Freed: worktreeNotice('done', 'Freed 1.1 GB', '3 removed, 12.4 GB freed so far'),
  Repaired: worktreeNotice('done', 'Repaired checkout-spike', 'It is linked to its repository again.'),
  'No agent': worktreeNotice('failed', 'Could not start the agent', 'no agent is installed'),
};

const pinned = (n, text, place, extra = {}) => ({ n, text, ...place, ...extra });
const iphone = 'iPhone 16 Pro · iOS 18.2';
const pixel = 'Pixel 8 · Android 15';
const iosNotes = [pinned(1, 'Pay sits under the home indicator', { at: [50, 97] }), pinned(2, 'The hold timer wraps on a narrow phone', { region: [7, 42, 86, 7] }), pinned(3, 'Shipping should say free over $75', { at: [80, 38] })];
export const samplePins = {
  scopes: {
    frozen: [iphone, 'frozen at 14:06:12'], live: [iphone, 'this computer'], kept: [iphone, 'kept from 13:52', 'not sent'], devbox: ['iPhone 16 Pro', 'frozen at 14:06:12', 'to migrate on devbox'],
    touches: [pixel, 'frozen at 14:06:40', 'touches wait'], rotated: [pixel, 'frozen at 14:08:02', 'rotated since'], stalled: ['Pixel 8', 'frozen at 14:05', 'the picture had stalled'], images: ['checkout', '~/acme-shop'],
  },
  ios: iosNotes,
  typing: [iosNotes[0], iosNotes[1], { ...iosNotes[2], writing: [40, 24] }],
  three: [iosNotes[0], { ...iosNotes[1], hover: true }, { ...iosNotes[2], chosen: true }],
  android: [pinned(1, 'Search keeps the old query after a result', { region: [5, 15, 90, 7] }), pinned(2, '', { at: [50, 93] }, { writing: [-8, 80] })],
  rotated: [pinned(1, 'Both cards should fit side by side', { at: [36, 92] })],
  stalled: [pinned(1, 'Road runner price should match the list', { at: [70, 39] })],
  file: { name: 'checkout-429.png', folder: '~/acme-shop/shots · 14:07' },
  agents: [{ name: 'checkout', project: 'acme-shop' }, { name: 'docs', project: 'acme-shop' }, { name: 'i18n', project: 'docs-site' }],
  sent: samplePull.sent,
  refusals: {
    send: { text: 'Couldn’t send to checkout', source: 'hc send: checkout is not running', fix: 'Send' },
    copy: { text: 'Couldn’t copy to devbox', source: 'scp: devbox: Connection timed out', fix: 'Send' },
  },
};

const shipRepo = (name, add, del, commits) => ({ name, lines: `${add} ${del}`, commits: `${commits} commits` });
const counted = (...pairs) => pairs.map(([value, unit]) => ({ value, unit }));
const shipRecord = (name, value, unit, detail, fresh = false) => ({ name, value, unit, detail, fresh });
const shipHours = [2, 1, 1, 1, 2, 4, 6, 10, 14, 18, 21, 17, 15, 20, 31, 50, 35, 23, 15, 10, 7, 5, 4, 3];
const shipDays = Array.from({ length: 7 * 26 }, (_, day) => [0, 1, 2, 4, 3, 1, 0, 2, 3, 1, 4][(day * 7 + Math.floor(day / 5)) % 11]);
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const contributionsOn = (level, day) => `${level * 2} contributions on ${weekdays[day % 7]}, week ${Math.floor(day / 7) + 1}`;
export const sampleShipped = {
  periods: [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' }],
  week: {
    period: 'week', label: 'This week',
    hero: { value: '+12,480', small: '−3,210', unit: 'lines' }, delta: { text: '18% on last week', up: true },
    counts: counted(['9', 'PRs merged'], ['112', 'commits'], ['6', 'reviews'], ['12', 'days in a row']),
    contributions: '340 contributions this week', ever: '1,204 pull requests merged, +412,300 lines and 9,870 commits in 64 repositories since you joined GitHub in 2014.',
    best: shipRecord('Best day', '+2,904', 'lines', 'Tue 11 Nov', true), days: shipDays, daysSaid: shipDays.map(contributionsOn),
    repos: { count: '11', more: 8, rows: [shipRepo('acme-shop', '+7,120', '−1,840', 61), shipRepo('relay', '+2,980', '−720', 28), shipRepo('billing', '+1,640', '−410', 18)] },
    rest: [shipRepo('docs', '+240', '−80', 4), shipRepo('cli', '+180', '−60', 2), shipRepo('search', '+120', '−40', 2), shipRepo('infra', '+90', '−30', 1), shipRepo('site', '+60', '−20', 1), shipRepo('mobile', '+30', '−10', 1), shipRepo('herdr-kanso', '+12', '−4', 1), shipRepo('notes', '+8', '−2', 1)],
  },
  day: {
    period: 'day', label: 'Yesterday', past: true,
    hero: { value: '31', unit: 'contributions' }, delta: { text: '12% on the day before', up: false },
    counts: counted(['2', 'PRs merged'], ['24', 'commits'], ['1', 'review']),
    repos: { count: 'this week', rows: [shipRepo('acme-shop', '+7,120', '−1,840', 61), shipRepo('relay', '+2,980', '−720', 28)] },
  },
  past: {
    period: 'week', label: 'Last week', past: true,
    hero: { value: '+10,576', small: '−2,720', unit: 'lines' }, delta: { text: '9% on the week before', up: true },
    counts: counted(['7', 'PRs merged'], ['94', 'commits'], ['4', 'reviews']),
    repos: { count: '2', rows: [shipRepo('acme-shop', '+7,120', '−1,840', 52), shipRepo('relay', '+3,456', '−880', 42)] },
  },
  addingUp: { hero: { value: '+4,310', unit: 'lines so far' }, counts: counted(['9', 'PRs merged'], ['112', 'commits'], ['6', 'reviews']) },
  phases: {
    first: 'Adding up: GitHub’s sums, 14 repositories to go. The first time takes a few minutes; after that only what changed is read.',
    again: 'Updating: this computer’s repositories, 3 to go.',
  },
  records: {
    count: '3', streak: { value: '12', unit: 'days in a row', longest: 'longest 28 days' },
    rows: [shipRecord('Best day', '+2,904', 'lines', 'Tue 11 Nov', true), shipRecord('Best week', '+12,480', 'lines', 'week of 9 Nov 2026'), shipRecord('Longest streak', '28', 'days', 'to 3 Oct 2026')],
  },
  rhythm: {
    note: 'mostly afternoons', ticks: ['00', '06', '12', '18', '23'], peak: shipHours.indexOf(Math.max(...shipHours)),
    counts: shipHours, hours: shipHours.map((count) => count / Math.max(...shipHours)),
    said: shipHours.map((count, hour) => `${String(hour).padStart(2, '0')}:00 · ${count} ${count === 1 ? 'commit' : 'commits'}`), spoken: 'Commits per hour',
  },
  computers: { count: '2', rows: [{ name: 'This Mac', lines: '+8,420 −2,100', commits: '72 commits' }, { name: 'devbox', lines: '+4,060 −1,110', commits: '40 commits' }] },
  empty: { label: 'Sun 2 Nov', period: 'day', past: true, empty: { icon: 'lu-trophy', text: 'Nothing shipped' } },
  signedOut: { icon: 'lu-git-pull-request', text: 'Not signed in to GitHub', action: 'Sign in' },
  noCli: { icon: 'lu-git-pull-request', text: 'GitHub CLI not installed', action: 'cli.github.com' },
  offline: 'Read 13:40 · GitHub not answering · next try 14:07',
  stopped: { text: 'Adding up stopped', source: 'GitHub: 502 Bad Gateway while reading relay', fix: 'Refresh' },
  noSqlite: { text: 'Adding up stopped', source: 'sqlite3 not found: install it to keep Shipped’s statistics', fix: 'Refresh' },
  leaves: 'Totals only, no names',
};
const { week: shipWeek, records: shipBests, rhythm: shipRhythm } = sampleShipped;
export const sampleShippedCard = {
  title: 'Shipped', subtitle: '@jordan', right: shipWeek.label, stats: [...shipWeek.counts, { value: '340', unit: 'contributions' }, { value: '11', unit: 'repositories this week' }], note: shipWeek.ever, address: 'github.com/jlopezlira/herdr-kanso',
  hero: { big: shipWeek.hero.value, small: shipWeek.hero.small, unit: shipWeek.hero.unit, delta: shipWeek.delta },
  blocks: [
    { kind: 'streak', title: 'Streak', right: shipBests.streak.longest, n: shipBests.streak.value, unit: shipBests.streak.unit, days: shipWeek.days },
    { kind: 'list', title: 'Records', rows: shipBests.rows },
    { kind: 'bars', title: 'When you ship', right: shipRhythm.note, values: shipRhythm.counts, ticks: shipRhythm.ticks },
  ],
};
export const sampleShippedNotices = {
  'New record': { state: 'done', home: 'shipped', text: 'New record: best day', detail: '+2,904 lines · Tue 11 Nov' },
};

const sharer = (title, leaves, tools = ['refresh']) => ({ title, leaves, tools });
const sevenDays = ['Wed', 'now'];
const stat = (value, unit) => ({ value, unit });
export const sampleShare = {
  panels: {
    memory: sharer('Memory', 'Counts and sizes only'),
    spend: sharer('Spend', 'Totals and days only', ['settings', 'refresh']),
    dojo: sharer('hjkl dōjō', 'Scores and practice days only', []),
  },
  network: 'Post to LinkedIn',
  save: 'Save image',
  file: 'Downloads/kanso-memory-2026-11-12.png',
  notices: {
    'In the post': { state: 'done', home: 'memory', text: 'Your LinkedIn post has the image and the text', detail: 'Check it and post. Not there? It is on the clipboard: ⌘V. Saved in Downloads/kanso-memory-2026-11-12.png.' },
    'Paste it': { state: 'done', home: 'memory', text: 'Paste the image into your LinkedIn post: ⌘V', detail: 'It is on the clipboard and in Downloads/kanso-memory-2026-11-12.png. Allow accessibility access to paste automatically.' },
    'Attach it': { state: 'done', home: 'memory', text: 'Attach kanso-memory-2026-11-12.png to your LinkedIn post', detail: '~/Downloads/kanso-memory-2026-11-12.png' },
    Saved: { state: 'done', home: 'memory', text: 'Memory image saved', detail: 'Downloads/kanso-memory-2026-11-12.png' },
  },
  failed: { state: 'failed', home: 'memory', text: 'The image could not be made', detail: 'Install Chrome, Chromium or rsvg-convert to make the image.' },
  unmade: { text: 'The image could not be made', source: 'Install Chrome, Chromium or rsvg-convert to make the image.', fix: 'Save image' },
  address: 'github.com/jlopezlira/herdr-kanso',
  cards: {
    Ports: {
      title: 'Ports', right: 'last 30 days', note: '1.6 GB of memory given back',
      hero: { big: '7', unit: 'servers', label: 'Left running after their panes closed, found and stopped' },
      stats: [stat('4', 'running now'), stat('8', 'at once at the peak'), stat('21', 'opened this week'), stat('9', 'left with no pane')],
      blocks: [{ kind: 'bars', title: 'Dev servers running, last 7 days', right: 'peak 8', values: [2, 3, 4, 8, 3, 2, 2], ticks: sevenDays }],
    },
    Memory: {
      title: 'Memory', right: 'since Nov 1', note: '4.2 GB given back by recycling, same conversations',
      hero: { big: '12', unit: 'days', label: 'My longest session, still open · 4 sessions on 32 GB' },
      stats: [stat('4', 'sessions open'), stat('8', 'recycles'), stat('2', 'closed'), stat('4.8 GB', 'given back'), stat('620 MB', 'Herdr window'), stat('1', 'window restart')],
      blocks: [{ kind: 'bars', title: 'Memory free, last 7 days', right: 'lowest 18%', values: [32, 24, 18, 24, 40, 32, 48], ticks: sevenDays }],
    },
    Spend: {
      title: 'Spend', right: 'This month', note: 'Pro plan · $20 per month',
      hero: { big: '$214.80', unit: 'of AI work at API list price', delta: { text: '18% more than last month', up: true } },
      stats: [stat('48', 'tasks'), stat('12.4M', 'tokens'), stat('5', 'projects'), stat('3', 'models')],
      blocks: [{ kind: 'bars', title: 'Daily spend', right: 'peak $24.10', values: [6, 10, 14, 24, 14, 9, 13], ticks: ['Nov 1', 'Nov 12'] }],
    },
    'Dōjō': {
      title: 'hjkl dōjō', subtitle: 'The vim game inside kansō, a layout for Herdr', right: 'since Nov 1', note: '10 targets in a row in the fewest moves',
      hero: { big: '980', unit: 'points', label: 'My best round of vim, ten targets, level 1: h l' },
      stats: [stat('120', 'targets reached'), stat('84%', 'in the fewest moves'), stat('12', 'rounds'), stat('7', 'days practiced')],
      blocks: [
        { kind: 'streak', title: 'Practice', right: 'h j k l, every day', n: '5', unit: 'days in a row', days: shipDays },
        { kind: 'list', title: 'Levels', rows: [{ name: '1 · best round', value: '980', unit: 'points' }, { name: '2 · best round', value: '820', unit: 'points' }] },
      ],
    },
    Shipped: sampleShippedCard,
  },
};

const simDevice = (name, runtime, state, picked = false) => ({ name, runtime, state, picked });
export const sampleSimulator = {
  groups: [
    { name: 'iOS', devices: [simDevice('iPhone 16 Pro', 'iOS 18.2', 'On', true), simDevice('iPhone SE (3rd generation)', 'iOS 18.2', 'Off'), simDevice('iPad Air 11-inch (M2)', 'iPadOS 18.2', 'Off')] },
    { name: 'Android', devices: [simDevice('Pixel 8', 'Android 15', 'On'), simDevice('Pixel 4 API 30', 'x86 image on arm', 'Off')] },
  ],
  scopes: { iphone: ['iPhone 16 Pro'], booted: ['iPhone 16 Pro', 'iOS 18.2', 'booted'], pixel: ['Pixel 8'], off: ['iPhone SE', 'off'], starting: ['iPhone SE', 'starting… 42s'], stalled: ['Pixel 8', 'as of 12s ago', 'emulator not answering', 'trying again'], offline: ['Pixel 8', 'offline'], image: ['Pixel 4 API 30', 'off'], unauthorized: ['R58M123', 'unauthorized'] },
  said: { remote: 'Devices are on this computer.', noEmulator: 'Android SDK emulator binary is missing.' },
  touch: [72, 41],
  narrow: [{ label: 'Trail runner', value: '$64' }, { label: 'Socks ×2', value: '$12' }],
  url: 'acme-shop://checkout',
  bare: { url: 'checkout', invalid: 'Enter a URL with a scheme, such as acme-shop://checkout.' },
  failures: {
    command: { text: 'Can’t reach Pixel 8', source: 'adb: device \'emulator-5554\' offline', fix: 'Refresh', agent: 'checkout' },
    start: { text: 'Couldn’t start iPhone SE', source: 'Start timed out.', fix: 'Start', agent: 'checkout' },
    url: { text: 'Couldn’t open acme-shop://checkout', source: 'simctl openurl: no app is registered for the acme-shop scheme', fix: 'Open a URL', agent: 'checkout' },
    read: { text: 'Couldn’t read the devices', source: 'Devices did not answer.', fix: 'Refresh' },
  },
  empty: { icon: 'lu-smartphone', text: 'No devices' },
};

export const sampleImages = {
  count: '1 of 3', agent: 'checkout',
  shots: [{ label: 'cart-countdown.png', selected: true }, { label: 'cart-old.png' }, { label: 'checkout-429.png' }],
  file: { name: 'cart-countdown.png', folder: '~/acme-shop/shots · 14:06' },
  held: { scope: 'migrate on devbox', action: 'Load 2.4 MB' },
  offline: 'Read 14:02 · devbox unreachable · next try 14:07',
  wrong: 'Images shows pictures: ~/acme-shop/notes.txt',
  waiting: { text: 'cart-ui needs you first', fix: 'Go to cart-ui' },
  sent: 'Sent to checkout 14:06',
  notSent: { text: 'Not sent', source: 'hc send: checkout is not running', fix: 'Send', agent: 'checkout' },
  failure: { text: 'Can’t show cart-old.png', source: 'sips: cart-old.png is not a picture', fix: 'Refresh', agent: 'checkout' },
  empty: { icon: 'lu-eye', text: 'No pictures in this conversation' },
  noAgent: { icon: 'lu-monitor', text: 'No agent in focus' },
  noConversation: { icon: 'lu-eye', text: 'No conversation to read pictures from' },
};
