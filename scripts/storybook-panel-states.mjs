// Compose retained panel features from the shared kit.
import { elements, frame as free } from './storybook-markup.mjs';
import { dialog } from '../stories/kit/pieces.js';

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const icon = (name) => `<svg class="kanso-icon" aria-hidden="true"><use href="#lu-${name}"/></svg>`;
const button = (text, kind = 'quiet', disabled = false) => `<button type="button" class="kanso-button kanso-button--${kind}"${disabled ? ' disabled' : ''}>${text}</button>`;
const primary = (text) => `<button type="button" class="kanso-button kanso-button--solid">${text}</button>`;
const tool = (name, title) => `<button type="button" class="kanso-button kanso-button--icon" aria-label="${title}" title="${title}">${icon(name)}</button>`;
const actions = (...items) => `<div class="kanso-actions">${items.join('')}</div>`;
const note = (text) => `<div class="kanso-panel__note">${text}</div>`;
const row = (name, value, focused = false) => `<div class="kanso-row${focused ? ' kanso-row--selected kanso-control--focus' : ''}" tabindex="0"><span class="kanso-row__name kanso-story__ellipsis" title="${esc(name)}">${name}</span><span class="kanso-row__value kanso-story__ellipsis" title="${esc(value)}">${value}</span></div>`;
const empty = (name, text) => `<div class="kanso-state-empty">${icon(name)}<div class="kanso-content__text">${text}</div></div>`;
const blocked = (what, why = '', ...fixes) => `<div class="kanso-state-block"><svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg><div class="kanso-state-block__what">${what}</div>${why ? `<div class="kanso-state-block__why" title="${esc(why)}">${why}</div>` : ''}${fixes.length ? `<div class="kanso-state-block__actions">${fixes.join('')}</div>` : ''}</div>`;

export function panelStateRecords(records) {
  const drawings = [], find = (part) => records.find((r) => r.id.includes(part) && r.html)?.html;
  const put = (page, component, state, html, behavior, anatomy) => drawings.push({ id: `panels/${page.split('/')[1].toLowerCase()}/Feature${component.replaceAll(' ', '')}/${state}`, source: 'panels', page, label: `${component} · ${state}`, caption: behavior, html, spec: [['Anatomy', anatomy], ['Values', 'Shared kit tokens, single-line rows with ellipsis, contextual controls.'], ['States', state], ['Behaviour', behavior], ['Principle', 'Kansō']] });
  const arranged = find('proto/approved-dialogs-arrange/Reference/1');
  if (arranged) {
    const shell = (options) => free(dialog({ scope: 'Opens in acme-shop', secondary: 'Close', primary: 'Save this tab', ...options }));
    const arrangement = (name, from = '', selected = false) => `<div class="kanso-row${selected ? ' kanso-row--selected' : ''}"><span>${name}</span><span class="kanso-layout__grow"></span>${from ? `<span class="kanso-row__meta">from ${from}</span>` : ''}${selected ? button('Overwrite') + button('Delete') : ''}</div>`;
    const group = (text) => `<div class="kanso-dialog__group">${text}</div>`;
    const list = (...rows) => `<div class="kanso-dialog__list">${rows.join('')}</div>`;
    const anatomy = 'The dialog shell: heading, scope, list and actions.';
    put('Panels/Arrangements', 'Arrangements', 'This project and other projects', shell({ title: 'Arrangements', kind: 'tonal', body: list(group('This project'), arrangement('web and api', '', true), arrangement('review pair'), group('Other projects, opened here'), arrangement('i18n', 'docs-site'), arrangement('release', 'infra')) }), 'Arrangements saved in other projects follow this project’s, under their own heading; each names the project it came from and opens here.', anatomy);
    put('Panels/Arrangements', 'Arrangements', 'Only other projects', shell({ title: 'Arrangements', kind: 'tonal', body: list(group('From other projects, opened here'), arrangement('i18n', 'docs-site', true), arrangement('release', 'infra')) }), 'With none saved in this project, the list is the other projects’ arrangements, opened here.', anatomy);
    put('Panels/Arrangements', 'Arrangements', 'sqlite3 missing', shell({ title: 'Arrangements', body: empty('layers', 'No arrangement yet.'), note: 'Install sqlite3 to keep arrangements.', tone: 'error' }), 'Without sqlite3 nothing can be read or kept; one line under the list says what to install.', anatomy);
    const shape = elements(arranged, 'kanso-arrangement')[0];
    const kept = { text: "Each program is kept with the flags you started it with. A resumed session's id is left out, so each agent starts fresh." };
    put('Primitives/Dialog', 'Save Arrangement', 'Save header', shell({ title: 'Save this tab', scope: 'An arrangement for acme-shop', value: 'checkout and docs', body: shape, notes: [kept], secondary: 'Back', primary: 'Save' }), 'Save this tab names the project the arrangement is for.', anatomy);
    put('Primitives/Dialog', 'Save Arrangement', 'Overwrite header', shell({ title: 'Overwrite web and api', scope: 'With this tab as it is now', value: 'web and api', body: shape, notes: [kept], note: 'This replaces the arrangement named web and api.', tone: 'muted', secondary: 'Back', primary: 'Overwrite' }), 'Overwrite on a row opens the save with that arrangement named in the heading; the tab as it is now replaces it.', anatomy);
  }
  const toast = (mark, text, fix = '') => free(`<div class="kanso-toast kanso-popover">${mark}<span class="kanso-content__text" title="${esc(text)}">${text}</span>${fix}</div>`);
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
  ]) put('Compositions/Notifications', 'Update Notice', state, toast(failed, `kansō was not updated: ${why}`, '<button type="button" class="kanso-button kanso-button--tonal">Update</button>'), behavior, notice);
  return drawings;
}
