// Compose retained panel features from the shared kit.
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const icon = (name) => `<svg class="kanso-icon" aria-hidden="true"><use href="#lu-${name}"/></svg>`;
const button = (text, kind = 'quiet', disabled = false) => `<button type="button" class="kanso-button--${kind}"${disabled ? ' disabled' : ''}>${text}</button>`;
const tool = (name, title) => `<button type="button" class="kanso-button--icon" aria-label="${title}" title="${title}">${icon(name)}</button>`;
const actions = (...items) => `<div class="kanso-actions">${items.join('')}</div>`;
const note = (text) => `<div class="kanso-panel__note">${text}</div>`;
const section = (text) => `<div class="kanso-section">${text}</div>`;
const row = (name, value, focused = false) => `<div class="kanso-row${focused ? ' kanso-row--selected kanso-control--focus' : ''}" tabindex="0"><span class="kanso-row__name kanso-story__ellipsis" title="${esc(name)}">${name}</span><span class="kanso-row__value kanso-story__ellipsis" title="${esc(value)}">${value}</span></div>`;
const pending = (text) => `<span class="kanso-state-line kanso-state-line--pending"><span class="kanso-state-line__pending-dot"></span>${text}</span>`;
const empty = (name, text) => `<div class="kanso-state-empty">${icon(name)}<div class="kanso-content__text">${text}</div></div>`;
const bones = (count = 4) => `<div class="kanso-skeleton__list kanso-skeleton--breathing" aria-label="Loading">${Array.from({ length: count }, () => '<div class="kanso-row"><span class="kanso-skeleton kanso-layout__grow"></span></div>').join('')}</div>`;
const failure = (what, why, fix = 'Refresh') => `<div class="kanso-state-block"><svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg><div class="kanso-state-block__what">${what}</div><div class="kanso-state-block__why" title="${esc(why)}">${why}</div><div class="kanso-state-block__actions">${button(fix, 'tonal')}<button type="button" class="kanso-button--tonal kanso-explain">${icon('bot')}Explain to checkout</button></div></div>`;
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
