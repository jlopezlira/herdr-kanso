// Compose retained panel features from the shared kit.
import { elements, frame as free } from './storybook-markup.mjs';

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const icon = (name) => `<svg class="kanso-icon" aria-hidden="true"><use href="#lu-${name}"/></svg>`;
const button = (text, kind = 'quiet', disabled = false) => `<button type="button" class="kanso-button--${kind}"${disabled ? ' disabled' : ''}>${text}</button>`;
const primary = (text) => `<button type="button" class="kanso-button">${text}</button>`;
const tool = (name, title) => `<button type="button" class="kanso-button--icon" aria-label="${title}" title="${title}">${icon(name)}</button>`;
const actions = (...items) => `<div class="kanso-actions">${items.join('')}</div>`;
const note = (text) => `<div class="kanso-panel__note">${text}</div>`;
const refused = (text) => `<div class="kanso-panel__note kanso-text--blocked">${text}</div>`;
const section = (text) => `<div class="kanso-section">${text}</div>`;
const row = (name, value, focused = false) => `<div class="kanso-row${focused ? ' kanso-row--selected kanso-control--focus' : ''}" tabindex="0"><span class="kanso-row__name kanso-story__ellipsis" title="${esc(name)}">${name}</span><span class="kanso-row__value kanso-story__ellipsis" title="${esc(value)}">${value}</span></div>`;
const pending = (text) => `<span class="kanso-state-line kanso-state-line--pending"><span class="kanso-state-line__pending-dot"></span>${text}</span>`;
const empty = (name, text) => `<div class="kanso-state-empty">${icon(name)}<div class="kanso-content__text">${text}</div></div>`;
const bones = (count = 4) => `<div class="kanso-skeleton__list kanso-skeleton--breathing" aria-label="Loading">${Array.from({ length: count }, () => '<div class="kanso-row"><span class="kanso-skeleton kanso-layout__grow"></span></div>').join('')}</div>`;
const failure = (what, why, fix = 'Refresh') => `<div class="kanso-state-block"><svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg><div class="kanso-state-block__what">${what}</div><div class="kanso-state-block__why" title="${esc(why)}">${why}</div><div class="kanso-state-block__actions">${button(fix, 'tonal')}<button type="button" class="kanso-button--tonal kanso-explain">${icon('bot')}Explain to checkout</button></div></div>`;
const blocked = (what, why = '', ...fixes) => `<div class="kanso-state-block"><svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg><div class="kanso-state-block__what">${what}</div>${why ? `<div class="kanso-state-block__why" title="${esc(why)}">${why}</div>` : ''}${fixes.length ? `<div class="kanso-state-block__actions">${fixes.join('')}</div>` : ''}</div>`;
const swap = (html, from, to) => {
  if (!html.includes(from)) throw new Error(`Drawing changed, cannot find: ${from.slice(0, 80)}`);
  return html.replace(from, () => to);
};
const metric = (value, unit) => `<div class="kanso-metric"><span class="kanso-metric__value">${value}</span><span class="kanso-metric__unit">${unit}</span></div>`;
const frame = (title, scope, body, tools = '', window = false) => `<div class="kanso-story"><div class="kanso-story__theme kanso-story__frame ${window ? 'kanso-story--free' : 'kanso-panel kanso-panel--fit'}"><div class="${window ? 'kanso-markdown--window' : 'kanso-panel'}"><div class="kanso-panel__header">${window && title !== 'Markdown' ? tool('chevron-left', 'Markdown in this folder') : ''}<span class="kanso-panel__title kanso-story__ellipsis">${title}</span>${tools}${tool('refresh-cw', 'Refresh')}${tool('x', 'Close')}</div><div class="kanso-panel__scope kanso-story__ellipsis" title="${esc(scope)}">${scope}</div>${body}</div></div></div>`;
const chart = (title, values, unit) => section(title) + `<div class="kanso-chart" role="img" aria-label="${title}: ${values.join(', ')} ${unit}, November 1 through today">${values.map((v, i) => `<i${v === Math.max(...values) ? ' class="kanso-chart__bar--peak"' : ''} style="height:calc(var(--k-sp-1) * ${v || 0.25})" title="Nov ${i + 1} · ${v} ${unit}"></i>`).join('')}</div><div class="kanso-chart__axis"><span>Nov 1</span><span>Today</span></div>`;

export function panelStateRecords(records) {
  const drawings = [], find = (part) => records.find((r) => r.id.includes(part) && r.html)?.html;
  const add = (page, component, state, html, behavior) => drawings.push({ id: `panels/${page.toLowerCase()}/Feature${component.replaceAll(' ', '')}/${state}`, source: 'panels', page: `Panels/${page}`, label: `${component} · ${state}`, caption: behavior, html, spec: [['Anatomy', `${component}: shared panel header, scope and kit state primitives.`], ['Values', 'Shared kit tokens, single-line rows with ellipsis, contextual controls.'], ['States', state], ['Behaviour', behavior], ['Principle', 'Kansō']] });
  if (find('panels/spend/SpendAtRestNow/')) {
    const history = (values, task = false) => {
      const total = values.reduce((sum, value) => sum + value, 0), peak = Math.max(...values);
      const bars = values.map((value, index) => {
        const tip = `Nov ${index + 1} · $${value.toFixed(2)} · ${(value * 24000).toLocaleString('en-US')} tokens`;
        return `<i class="${value ? value === peak ? 'kanso-chart__bar--peak' : '' : 'kanso-chart__bar--empty'}" style="height:${value ? `calc(var(--k-sp-4) * ${value / peak * 5})` : 'var(--k-sp-hair)'}" role="listitem" aria-label="${tip}" title="${tip}">${value && value === peak ? `<span class="kanso-chart__value">$${value.toFixed(2)}</span>` : ''}</i>`;
      }).join('');
      return frame('Spend', task ? 'checkout' : 'All computers', metric(`$${total.toFixed(2)}`, 'API value this month') + (total ? '' : empty('chart-column', 'No usage this month')) + `<div class="kanso-chart__bars kanso-chart--spend" role="list" aria-label="API value per day">${bars}</div><div class="kanso-chart__ticks"><span>Nov 1</span><span>Per day</span><span>Nov 30</span></div>`, tool('sliders-vertical', 'Sources and plans'));
    };
    for (const [state, values, task] of [
      ['Period bars', [0, 12, 0, 30, 45, 0, 8, 18, 0, 5, 0, 10, 0], false],
      ['Task bars', [0, 0, 0, 12, 20, 0, 3, 8, 0, 0, 0, 2, 0], true],
      ['Empty bars', [], false],
    ]) add('Spend', 'Spend History', state, history([...values, ...Array(30 - values.length).fill(0)], task), `Proposed. Sample ${task ? 'task' : 'period'} history retains daily bars, zero days, peak value and cost/token tooltips from the current app.`);
  }
  const put = (page, component, state, html, behavior, anatomy) => drawings.push({ id: `panels/${page.split('/')[1].toLowerCase()}/Feature${component.replaceAll(' ', '')}/${state}`, source: 'panels', page, label: `${component} · ${state}`, caption: behavior, html, spec: [['Anatomy', anatomy], ['Values', 'Shared kit tokens, single-line rows with ellipsis, contextual controls.'], ['States', state], ['Behaviour', behavior], ['Principle', 'Kansō']] });
  const arranged = find('proto/approved-dialogs-arrange/Reference/1');
  if (arranged) {
    const dialog = (heading, scope, body) => free(`<div class="kanso-dialog--settings" style="width:420px"><div class="kanso-dialog__heading"><span class="kanso-content__text">${heading}</span></div><div class="kanso-dialog__scope">${scope}</div>${body}</div>`);
    const arrangement = (name, from = '', selected = false) => `<div class="kanso-row${selected ? ' kanso-row--selected' : ''}"><span>${name}</span><span class="kanso-layout__grow"></span>${from ? `<span class="kanso-row__meta">from ${from}</span>` : ''}${selected ? button('Overwrite') + button('Delete') : ''}</div>`;
    const group = (text) => `<div class="kanso-dialog__group">${text}</div>`;
    const list = (...rows) => `<div class="kanso-dialog__list">${rows.join('')}</div>`;
    const anatomy = 'The dialog shell: heading, scope, list and actions.';
    put('Panels/Arrangements', 'Arrangements', 'This project and other projects', dialog('Arrangements', 'Opens in acme-shop', list(group('This project'), arrangement('web and api', '', true), arrangement('review pair'), group('Other projects, opened here'), arrangement('i18n', 'docs-site'), arrangement('release', 'infra')) + actions(button('Close'), button('Save this tab', 'tonal'))), 'Arrangements saved in other projects follow this project’s, under their own heading; each names the project it came from and opens here.', anatomy);
    put('Panels/Arrangements', 'Arrangements', 'Only other projects', dialog('Arrangements', 'Opens in acme-shop', list(group('From other projects, opened here'), arrangement('i18n', 'docs-site', true), arrangement('release', 'infra')) + actions(button('Close'), button('Save this tab', 'tonal'))), 'With none saved in this project, the list is the other projects’ arrangements, opened here.', anatomy);
    put('Panels/Arrangements', 'Arrangements', 'sqlite3 missing', dialog('Arrangements', 'Opens in acme-shop', empty('layers', 'No arrangement yet.') + refused('Install sqlite3 to keep arrangements.') + actions(button('Close'), primary('Save this tab'))), 'Without sqlite3 nothing can be read or kept; one line under the list says what to install.', anatomy);
    const shape = elements(arranged, 'kanso-arrangement')[0];
    const kept = note("Each program is kept with the flags you started it with. A resumed session's id is left out, so each agent starts fresh.");
    const field = (name) => `<div class="kanso-field kanso-control--focus kanso-dialog__section">${name}<span class="kanso-field__caret"></span></div>`;
    put('Primitives/Dialog', 'Save Arrangement', 'Save header', dialog('Save this tab', 'An arrangement for acme-shop', field('checkout and docs') + shape + kept + actions(button('Back'), primary('Save'))), 'Save this tab names the project the arrangement is for.', anatomy);
    put('Primitives/Dialog', 'Save Arrangement', 'Overwrite header', dialog('Overwrite web and api', 'With this tab as it is now', field('web and api') + shape + kept + note('This replaces the arrangement named web and api.') + actions(button('Back'), primary('Overwrite'))), 'Overwrite on a row opens the save with that arrangement named in the heading; the tab as it is now replaces it.', anatomy);
  }
  const toast = (mark, text, fix = '') => free(`<div class="kanso-toast">${mark}<span class="kanso-content__text" title="${esc(text)}">${text}</span>${fix}</div>`);
  const done = '<svg class="kanso-icon kanso-icon--row" aria-hidden="true"><use href="#lu-check"/></svg>';
  const failed = '<svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg>';
  const notice = 'The toast: mark, one line, at most one action.';
  for (const [state, notes, behavior] of [
    ['Installed, keys updated', "kansō's keys updated.", 'The release changed kansō’s keys; yours were merged with them.'],
    ['Installed, kept your keys', "kansō's keys updated. Kept your own cmd-d, cmd-shift-w.", 'Keys you changed yourself stay yours and are named.'],
    ['Installed, keys.json unreadable', "Your keys.json could not be read, so kansō's keys were left as they are.", 'An unreadable keys.json is left untouched.'],
    ['Installed, new layout', 'New layout; the one you had is in layouts/kanso.json.old-*.', 'A changed layout replaces yours, which is kept beside it.'],
  ]) put('Compositions/Notifications', 'Update Notice', state, toast(done, `kansō updated to 3.31.0: ${notes}`), behavior, notice);
  for (const [state, why, behavior] of [
    ['Install failed, Windows tool missing', 'curl.exe is not on PATH; nothing was downloaded another way', 'On Windows the update needs curl.exe and tar.exe; nothing else downloads it.'],
    ['Install failed, Windows folder not moved', 'could not put kanso-tabs in place: C:\\Users\\you\\AppData\\Roaming\\herdr-app\\mods\\kanso-tabs', 'On Windows a mod folder that cannot be moved stops the update; what you had stays in place.'],
  ]) put('Compositions/Notifications', 'Update Notice', state, toast(failed, `kansō was not updated: ${why}`, '<button type="button" class="kanso-button--tonal">Update</button>'), behavior, notice);
  const ports = find('panels/ports/PortsAtRestNow/Default');
  if (ports) put('Panels/Ports', 'Ports', 'Not attributed', ports.replace(/(?:<\/div>){4}$/, (end) => blocked('Some servers cannot be attributed', 'Working directories require a Herdr API on Windows.') + end), 'Where working directories cannot be read, servers are still listed and can be stopped; the panel says why they have no project.', 'The panel: header, rows and the failure block.');
  const pinned = find('panels/images/ImagesTwoNotesReadyToSend/Default');
  if (pinned) {
    const one = swap(swap(pinned, '<span class="kanso-annotation" style="left:30%;top:88%">2</span>', ''), elements(pinned, 'kanso-panel__annotation')[1], '');
    put('Panels/Images', 'Images', 'One pin, no session to send to', swap(one, '<div class="kanso-actions"><span class="kanso-button">Send to checkout</span><span class="kanso-button--quiet">Open</span><span class="kanso-button--quiet">Clear 2 pins</span></div>', refused('No agent to send to') + actions(primary('Send'), button('Open'), button('Clear the pin'))), 'Send with no session in focus says so and keeps the pin; Clear the pin removes it.', 'The panel: picture, pin list, the failure block and the action row.');
  }
  const dojo = find('proto/layouts-hjkl-dojo/HjklDojo/Default');
  if (dojo) put('Panels/Dojo', 'Practice Feedback', 'sqlite3 missing', swap(dojo, 'Make a move to start: 10 targets, in as few moves as you can.', 'Install sqlite3 to keep your rounds.'), 'Without sqlite3 the dōjō plays, and the line under Hachi says rounds are not kept.', 'The dōjō: path, board, feedback line and keyboard.');
  const shipped = find('panels/shipped/ShippedGitHubCLINotInstalled/Default');
  if (shipped) put('Panels/Shipped', 'Shipped', 'sqlite3 missing', swap(shipped, elements(shipped, 'kanso-state-empty')[0], blocked('Adding up stopped', "Install sqlite3 to keep Shipped's statistics.")), 'Without sqlite3 nothing is added up; the tool’s words say what to install.', 'The panel: header, scope and the failure block.');
  const pr = find('panels/pr/PRDetailsDetailsOpen/Default');
  if (pr) {
    const file = (name, folder, stat, status = '') => `<div class="kanso-row">${status ? `<span class="kanso-file__status kanso-text--dim">${status}</span>` : '<span class="kanso-file__spacer"></span>'}<span class="kanso-row__filename">${name}</span><span class="kanso-row__directory-path">${folder}</span><span class="kanso-row__meta">${stat}</span></div>`;
    const files = [['checkout.ts', 'src/api', '+14 −3'], ['limits.ts', 'src/api', '+22', 'A'], ['limits.test.ts', 'src/api', '+6 −4'], ['bucket.ts', 'src/api', '+31', 'A'], ['cart.tsx', 'src/web', '+9 −2'], ['retry.ts', 'src/web', '+12'], ['en.json', 'locales', '+3'], ['de.json', 'locales', '+3']].map((f) => file(...f)).join('');
    put('Panels/PR', 'Pull Request Details', 'Files cut off', frame('#142', 'acme-shop · checkout-v2 → main', `<div class="kanso-section">Files<span class="kanso-row__detail">140 · +4,812 −1,206</span></div>${files}${actions(button('Show 92 more'))}${note('GitHub lists the first 100 of 140 files.')}`), 'Past 100 files GitHub lists only the first 100; the panel says how many there are.', 'The panel: header, scope, Files section, rows and one quiet line.');
  }
  if (!find('components-markdown-window/MarkdownWindow/') || !find('SimulatorAndroidTouchKeysTheDevicesButtons/')) return drawings;
  const document = find('components-markdown-window/MarkdownWindow/').match(/<div class="kanso-markdown__document">[\s\S]*(?=<\/div><\/div><\/div><\/div>$)/)[0];
  const code = '<div class="kanso-code"><span class="kanso-row__name">1</span>const LIMIT = { free: 40, pro: 400 };\n<span class="kanso-row__name">2</span>const REFILL_MS = 1000;</div>';
  const md = (body, scope = '~/acme-shop/docs', tools = '') => frame('plan.md', scope, body, tool('code', 'Source') + tools, true);
  const preview = (body, scope = '~/acme-shop/docs', tools = '', title = 'limits.md') => frame(title, scope, body, tool('code', 'Source') + tool('external-link', 'Open with…') + tools);
  const worktrees = (body) => frame('Worktrees', 'This computer', body, tool('plus', 'New worktree') + tool('share', 'Share'));
  const sim = (body, scope = 'This computer') => frame('Simulator', scope, body, tool('smartphone', 'Devices'));
  const wt = (component, state, body, behavior) => add('Worktrees', component, state, worktrees(body), behavior);
  const details = [
    ['Detached', 'Detached, its commits are on branches', 'Nothing is lost.', true],
    ['Locked', 'Locked', 'Locked: run git worktree unlock to remove it.', false],
    ['Lost', '2 commits only here', 'Loses 2 commits no branch has.', true],
    ['Merged', 'Merged', 'Nothing is lost. Branch feat/checkout goes too: its work is in develop.', true],
    ['Missing', 'Folder gone', "Its folder is already gone; only git’s record of it is removed.", true],
    ['Orphan', 'Its repository moved or was deleted', 'The folder is deleted. Git cannot say what is in it.', true],
    ['Recent', 'In use today', 'Nothing is lost. Branch feat/checkout stays. Clean up and Remove all leave this worktree alone.', true],
    ['Replaced', 'Folder reused', 'Its folder is now a repository of its own and stays as it is; only the old worktree record is removed.', true],
    ['Unmerged', 'Not merged, 3 commits stay on its branch', 'Nothing is lost. Branch feat/checkout stays with its 3 commits.', true],
  ];
  for (const [state, verdict, consequence, removable] of details) {
    const missing = ['Missing', 'Replaced'].includes(state);
    wt('Worktree Verdict', state, section(state === 'Orphan' ? 'Left behind' : 'acme-shop') + row(state === 'Detached' || state === 'Lost' ? 'a82f9c1' : 'feat/checkout', missing ? '0 KB' : '380 MB', true) + `<div class="kanso-worktree__details"><div class="kanso-worktree__reason">${verdict}</div>${note(consequence)}<div class="kanso-worktree__path">~/.kanso/worktrees/acme-shop/checkout</div>${actions(...(missing ? [] : [button('Open in a new tab'), button('Explain it')]), ...(removable ? [button(missing ? 'Prune 1 record' : 'Remove')] : []))}</div>`, `${verdict}. ${consequence}`);
  }
  wt('Worktrees', 'Removing', section('acme-shop') + row('feat/checkout', '380 MB') + note(pending('Removing…')) + actions(button('Remove', 'quiet', true), button('Clean up', 'quiet', true)), 'The selected removal is pending; other destructive controls wait.');
  wt('Worktrees', 'Notice', metric('380 MB', 'freed') + `<div class="kanso-toast"><span class="kanso-content__text">Removed 1 worktree and 1 merged branch</span></div>` + row('feat/search', '240 MB'), 'Completed cleanup leaves the remaining worktrees visible.');
  wt('Worktrees', 'History failed', metric('2.4 GB', 'in 9 worktrees') + section('Freed') + failure('Can’t read cleanup history', 'SQLITE_READONLY: database is read only') + row('feat/checkout', '380 MB'), 'A history failure keeps the current scan and offers Refresh.');
  wt('Worktree History', 'sqlite3 missing', metric('2.4 GB', 'in 9 worktrees') + section('Freed') + blocked("Can't read the history", 'Install sqlite3 to keep the history of your worktrees.') + row('feat/checkout', '380 MB'), 'Without sqlite3 the scan still shows; only the history says what to install.');
  const freed = metric('1.8 GB', 'of disk freed') + note('1.2 GB here, 600 MB removed outside the panel since a scan saw them.') + row('Worktrees removed', '8') + row('Merged branches deleted', '5') + row('Leftovers cleared', '3');
  wt('Worktree History', 'Freed', section('Freed · since Nov 1') + freed + chart('Freed each day', [0, 3, 0, 6, 2, 0, 8, 1, 0, 4, 0, 2], '100 MB'), 'Totals separate removals here from those outside the panel and count worktrees, merged branches and leftovers.');
  wt('Worktree History', 'History loading', metric('2.4 GB', 'in 9 worktrees') + section('Freed') + bones() + row('feat/checkout', '380 MB'), 'The current scan remains while only the history section loads.');
  wt('Worktree History', 'No history', metric('0 KB', 'of disk freed') + empty('git-fork', 'Nothing freed yet') + chart('In worktrees each day', [2, 2, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6], '400 MB'), 'Nothing freed yet; retained scans still show disk held over time.');
  wt('Worktree History', 'Disk split', section('Where the space is') + metric('2.4 GB', 'in 9 worktrees') + row('Can go, losing nothing · 3', '1.2 GB · 50%') + row('Need a look · 2', '480 MB · 20%') + row('In use or open · 2', '480 MB · 20%') + row('Left behind · 1', '120 MB · 5%') + row('Still checking · 1', '120 MB · 5%'), 'Disk usage includes counts, sizes and percentages for every verdict group.');
  wt('Worktree History', 'Repository split', section('The repositories that take the most') + row('acme-shop · 6 worktrees', '1.6 GB') + row('infra · 2 worktrees', '680 MB') + row('Left behind · 1 folder', '120 MB'), 'Repositories are ordered by disk held, with leftover folders kept separately.');
  wt('History Chart', 'Disk freed', metric('1.8 GB', 'freed since Nov 1') + chart('Freed each day', [0, 3, 0, 6, 2, 0, 8, 1, 0, 4, 0, 2], '100 MB'), 'Each day has a size tooltip; the peak is highlighted, and zero days remain visible.');
  wt('History Chart', 'Disk held', metric('2.4 GB', 'in worktrees today') + chart('In worktrees each day', [4, 5, 5, 7, 6, 8, 6, 6, 7, 6, 6, 6], '400 MB'), 'Retained scans show disk held independently of cleanup totals.');

  add('Preview', 'Preview', 'Loading', preview(bones(), '~/acme-shop/src/api', '', 'limits.ts'), 'The file header stays while its text loads.');
  add('Preview', 'Preview', 'Read failed', preview(failure('Can’t read limits.ts', 'EACCES: permission denied, open limits.ts'), '~/acme-shop/src/api', '', 'limits.ts'), 'Read failure offers Refresh and the source error.');
  add('Preview', 'Preview', 'Picture failed', preview(failure('Can’t show checkout.png', 'Cannot show this picture'), '~/acme-shop/screens', '', 'checkout.png'), 'A failed picture keeps Open with and Refresh available.');
  add('Preview', 'Preview', 'Save failed', preview(failure('Couldn’t save limits.ts', 'EACCES: permission denied, write limits.ts', 'Save') + code + actions(button('Discard')), '~/acme-shop/src/api · Edited', '', 'limits.ts'), 'The draft stays after a refused save; Save retries and Discard remains available.');
  add('Preview', 'Markdown Editing', 'Append', preview(document + '<div class="kanso-markdown__editor kanso-control--focus" tabindex="0" role="textbox" aria-label="New Markdown block">## Rollout<span class="kanso-field__caret"></span></div>', '~/acme-shop/docs · Edited', button('Discard')), 'Double-clicking below the final block appends an editable block; Escape returns to reading.');
  add('Preview', 'Markdown Editing', 'Image failed', preview(document + failure('Can’t show diagram.png', 'Cannot show this picture')), 'A failed inline image leaves the surrounding Markdown readable.');
  add('Preview', 'Markdown Editing', 'Loading', preview(bones(6)), 'Markdown blocks load beneath the document controls.');
  add('Preview', 'Markdown Editing', 'Save failed', preview(failure('Couldn’t save limits.md', 'EACCES: permission denied, write limits.md', 'Save') + document, '~/acme-shop/docs · Edited', button('Discard')), 'The Markdown draft remains available after the write fails.');
  add('Preview', 'Markdown Editing', 'Saving', preview(document, '~/acme-shop/docs · Saving…', pending('Saving…')), 'The edited Markdown remains visible during the pending write.');
  add('Preview', 'Markdown Editing', 'Stale', preview(document + note('devbox did not answer. Changes save when it is back.'), 'devbox: ~/acme-shop/docs · as of 14:06', button('Discard')), 'The last document and local draft remain while the remote computer is unreachable.');
  add('Preview', 'Code Limits', 'Truncated code', preview(code + '<div class="kanso-code">… (file truncated)</div>', '~/acme-shop/src/api · Read only', '', 'limits.ts'), 'Code beyond 400,000 characters is truncated and read only.');
  add('Preview', 'Code Limits', 'Truncated markdown', preview(document + '<div class="kanso-markdown__section">… (file truncated)</div>', '~/acme-shop/docs · Read only'), 'The Markdown renderer ends its retained content with the truncation marker.');

  const list = (body, scope = '~/acme-shop/docs') => frame('Markdown', scope, body, '', true);
  add('Markdown', 'Markdown Files', 'Empty', list(empty('file', 'No Markdown in ~/acme-shop/docs')), 'An empty folder keeps the window controls available.');
  add('Markdown', 'Markdown Files', 'Loading', list(bones()), 'The folder list is loading, with no false empty message.');
  add('Markdown', 'Markdown Files', 'Keyboard', list(section('In this folder') + row('plan.md', '', true) + row('limits.md', 'api')), 'The focused file row uses the kit focus ring.');
  add('Markdown', 'Markdown Files', 'Recent', list(section('From this terminal') + row('notes.md', '~/acme-shop') + section('In this folder') + row('plan.md', '') + row('limits.md', 'api')), 'Recent terminal documents appear before folder files and retain their folder context.');
  add('Markdown', 'Markdown Files', 'Remote', list(section('In this folder') + row('plan.md', '') + row('limits.md', 'api'), 'devbox: /srv/acme-shop/docs'), 'Remote files keep their computer and folder visible.');
  add('Markdown', 'Markdown Files', 'Review waiting', list(section('Waiting for your review') + row('plan.md', '~/acme-shop/docs') + row('release.md', '~/infra') + section('From this terminal') + row('notes.md', '~/acme-shop') + section('In this folder') + row('limits.md', 'api')), 'Pending reviews stay first and can be reopened after closing a document.');
  add('Markdown', 'Markdown Review', 'Review', md(document, '~/acme-shop/docs · checkout waits for your review', button('Done', 'tonal')), 'Done saves the document, answers every waiting review for this file and closes when no review remains.');
  add('Markdown', 'Markdown Review', 'Another review', md(document + note('release.md also waits for your review'), '~/acme-shop/docs · checkout waits for your review', button('Done', 'tonal')), 'Done on this document opens the next waiting review instead of closing the window.');
  add('Markdown', 'Markdown Review', 'Saving', md(document, '~/acme-shop/docs · checkout waits for your review', pending('Saving…') + button('Done', 'tonal', true)), 'The document stays while Done flushes its pending write.');
  add('Markdown', 'Markdown Review', 'Save failed', md(failure('Couldn’t save plan.md', 'EACCES: permission denied, write plan.md', 'Save') + document, '~/acme-shop/docs · checkout waits for your review · Edited', button('Done', 'tonal')), 'The draft and review stay available after a failed document write.');
  add('Markdown', 'Markdown Review', 'Marker failed', md(failure('Review not delivered', 'md-review was not told: EACCES: permission denied', 'Done') + document, '~/acme-shop/docs · checkout waits for your review'), 'Done retries telling the waiting session; the header does not repeat the failed action.');

  const iosControls = (acting = false, url = 'acme-shop://checkout') => actions(button('Open in Simulator', 'quiet', acting), button('Appearance light', 'quiet', acting), button('Appearance dark', 'quiet', acting), button('Shut down', 'quiet', acting)) + `<div class="kanso-actions"><input class="kanso-field kanso-layout__grow" aria-label="Device URL" value="${url}"${url === 'checkout' ? ' aria-invalid="true"' : ''}>${button('Open a URL', 'quiet', acting || url === 'checkout')}</div>`;
  const android = find('SimulatorAndroidTouchKeysTheDevicesButtons/').replace('width:200px;height:420px', 'width:calc(var(--k-sp-4) * 12.5);height:calc(var(--k-sp-4) * 26.25)');
  const screen = android.match(/<div class="kanso-simulator kanso-panel--focus">[\s\S]*?(?=<div class="kanso-panel__tools">)/)[0].trim();
  add('Simulator', 'Device Controls', 'Acting', sim(row('iPhone 16 Pro', 'iOS 18 · Booted') + note(pending('Appearance dark…')) + iosControls(true)), 'All device commands wait while one command runs.');
  add('Simulator', 'Device Controls', 'URL invalid', sim(row('iPhone 16 Pro', 'iOS 18 · Booted') + iosControls(false, 'checkout') + note('Enter a URL with a scheme, such as acme-shop://checkout.')), 'An invalid URL cannot be opened; other device controls stay available.');
  add('Simulator', 'Devices', 'Empty', sim(empty('smartphone', 'No devices')), 'Installed tools returned no devices; Refresh reads them again.');
  add('Simulator', 'Devices', 'Emulator binary missing', sim(row('Pixel 8', 'Android · Off') + note('Android SDK emulator binary is missing.') + empty('smartphone', 'Off')), 'adb is installed but an emulator cannot be started without its binary.');
  add('Simulator', 'Devices', 'Offline', sim(row('Pixel 8', 'Android · Off', true) + note('offline') + empty('smartphone', 'Off')), 'An offline Android device keeps its row but has no active screen controls.');
  add('Simulator', 'Devices', 'Unauthorized', sim(row('R58M123', 'Android · Off', true) + note('unauthorized') + empty('smartphone', 'Off')), 'An Android device awaiting trust remains listed with the source status.');
  add('Simulator', 'Devices', 'Remote project', sim(row('Pixel 8', 'Android · Booted', true) + note('Devices are on this computer.') + screen + android.slice(android.indexOf('<div class="kanso-panel__tools">'), android.lastIndexOf('</div></div></div>')) + actions(button('Rotate'), button('Shut down')), 'devbox: ~/acme-shop · Devices on this computer'), 'A remote project still uses the devices attached to this computer.');
  add('Simulator', 'Devices', 'Start timed out', sim(row('Pixel 8', 'Android · Off', true) + failure('Couldn’t start Pixel 8', 'Start timed out.', 'Start')), 'A start timeout returns the device to Off and offers Start again.');
  add('Simulator', 'Picture State', 'Key focus', android.replace('kanso-simulator kanso-panel--focus', 'kanso-simulator kanso-panel--focus kanso-control--focus').replace('<div class="kanso-panel__tools">', '<div class="kanso-panel__scope">Keyboard · type, paste, Enter, Backspace and arrow keys go to Pixel 8</div><div class="kanso-panel__tools">'), 'A focused Android picture receives keyboard input, paste and touch gestures.');
  add('Simulator', 'Picture State', 'No picture', sim(row('iPhone 16 Pro', 'iOS 18 · Booted') + empty('smartphone', 'No picture from the device') + iosControls()), 'A booted device with no frame still offers its commands and Refresh.');
  return drawings;
}
