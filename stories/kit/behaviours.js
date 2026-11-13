import { content, statesFor } from './catalog.js';

export const ARM_MS = 4000;
export const behaviours = {
  'kanso-reference__link': 'action',
  'kanso-segmented': 'select',
  'kanso-segmented--options': 'select',
  'kanso-segmented--sidebar': 'select',
  'kanso-segmented--tabs': 'select',
  'kanso-rail__views': 'select',
  'kanso-tab-bar': 'select',
  'kanso-tab': 'select',
  'kanso-tab--panel': 'select',
  'kanso-tab--rest': 'select',
  'kanso-tab-bar__button': 'action',
  'kanso-switch': 'toggle',
  'kanso-panel__switch-row': 'toggle',
  'kanso-field': 'field',
  'kanso-field--search': 'field',
  'kanso-markdown__editor': 'field',
  'kanso-button': 'action',
  'kanso-button--quiet': 'action',
  'kanso-button--tonal': 'action',
  'kanso-button--icon': 'action',
  'kanso-button--inline-icon': 'action',
  'kanso-button--square': 'action',
  'kanso-button--count': 'action',
  'kanso-button--disclosure': 'action',
  'kanso-sidebar__icon-button': 'action',
  'kanso-action': 'armed',
  'kanso-button--armed': 'armed',
  'kanso-menu': 'surface',
  'kanso-menu-item': 'action',
  'kanso-dialog': 'surface',
  'kanso-dialog--settings': 'surface',
  'kanso-dialog--worktree': 'surface',
  'kanso-sidebar__dialog': 'surface',
  'kanso-row': 'row',
  'kanso-row--two-lines': 'row',
  'kanso-row--interactive': 'row',
  'kanso-row--sleeping': 'row',
  'kanso-agent': 'row',
  'kanso-project': 'row',
  'kanso-machine': 'row',
  'kanso-sidebar__row': 'row',
  'kanso-sidebar__footer-row': 'action',
  'kanso-activity__row': 'row',
  'kanso-dialog__row': 'row',
  'kanso-search__hit': 'row',
  'kanso-minimap__tile': 'row',
  'kanso-thumbnail': 'row',
  'kanso-rail__tile': 'row',
  'kanso-keyboard__key': 'row',
  'kanso-simulator__note-point': 'row',
  'kanso-section--collapsible': 'fold',
  'kanso-sidebar__section': 'fold',
  'kanso-sidebar__group': 'fold',
  'kanso-activity__header': 'fold',
  'kanso-header__grip': 'drag',
  'kanso-dawn__replay': 'replay',
  'kanso-simulator__screen--annotating': 'annotate',
  'kanso-skeleton': 'animate',
};

const groups = '.kanso-segmented,.kanso-segmented--options,.kanso-segmented--sidebar,.kanso-segmented--tabs,.kanso-rail__views,.kanso-tab-bar';
const surfaces = '.kanso-menu,.kanso-dialog,.kanso-dialog--settings,.kanso-dialog--worktree,.kanso-sidebar__dialog';
const selector = Object.keys(behaviours).map((name) => `.${name}`).join(',');
const disabled = (node) => !!node.closest('[disabled],[aria-disabled="true"],[aria-busy="true"],.kanso-control--off,.kanso-button--off,.kanso-button--pending,.kanso-menu-item--busy');
const normal = (label) => label.trim().toLowerCase();
const labelOf = (node) => node.getAttribute('aria-label') || node.title || node.textContent.trim() || node.querySelector('use')?.getAttribute('href')?.replace('#lu-', '') || 'Action';
const editorValue = (node) => (node.value ?? node.textContent).replaceAll('\u200b', '').trim();

export function matchingState(states, label, current) {
  const wanted = normal(label).replace(/^all$/, 'all time');
  const active = states.find((state) => state.value === current);
  const family = active?.label.split(' · ').slice(0, -1).join(' · ');
  const candidates = states.filter((state) => normal(state.label) === wanted || normal(state.label.split(/ · |, /).at(-1)) === wanted);
  return candidates.find((state) => family && state.label.startsWith(`${family} · `)) ?? candidates.find((state) => normal(state.label) === wanted) ?? candidates[0];
}

export function mountBehaviours(root, { page, state, inlineSurfaces = false, updateArgs = () => {} } = {}) {
  const doc = root.ownerDocument;
  const states = statesFor(page);
  const abort = new AbortController();
  const overlays = new Map(), triggers = new Map(), originals = new Map();
  let armed = null, armTimer, undoAction;
  const remember = (node) => {
    if (!originals.has(node)) originals.set(node, { html: node.innerHTML, label: node.getAttribute('aria-label'), action: node.classList.contains('kanso-action') });
  };
  const disarm = () => {
    clearTimeout(armTimer);
    if (!armed) return;
    const original = originals.get(armed);
    armed.innerHTML = original.html;
    armed.classList.toggle('kanso-action', original.action);
    armed.classList.remove('kanso-action--armed', 'kanso-button--armed');
    if (original.label) armed.setAttribute('aria-label', original.label);
    else armed.removeAttribute('aria-label');
    armed = null;
  };
  const chooseState = (label) => {
    const next = matchingState(states, label, state);
    if (!next || next.value === state) return false;
    disarm();
    updateArgs({ state: next.value });
    return true;
  };
  const status = (message, undo) => {
    if (abort.signal.aborted) return;
    undoAction = undo;
    root.querySelector('.kanso-story__feedback')?.remove();
    const line = doc.createElement('div');
    line.className = 'kanso-story__feedback kanso-story__theme';
    line.setAttribute('role', 'status');
    line.append(message);
    if (undo) {
      const button = doc.createElement('button');
      button.className = 'kanso-button--tonal';
      button.textContent = 'Undo';
      button.type = 'button';
      line.append(button);
    }
    root.append(line);
  };
  const close = (surface, focus = false) => {
    surface.hidden = true;
    surface.setAttribute('aria-hidden', 'true');
    const trigger = overlays.get(surface);
    trigger?.setAttribute('aria-expanded', 'false');
    if (focus) trigger?.focus();
    disarm();
  };
  const open = (surface, trigger) => {
    for (const other of overlays.keys()) if (other !== surface) close(other);
    overlays.set(surface, trigger);
    surface.hidden = false;
    surface.setAttribute('aria-hidden', 'false');
    trigger?.setAttribute('aria-expanded', 'true');
    surface.querySelector('[role="menuitem"]:not([aria-disabled="true"]),[contenteditable="true"],input,button,[tabindex="0"]')?.focus();
  };
  const prepare = (scope) => {
    for (const field of scope.querySelectorAll('.kanso-field,.kanso-field--search,.kanso-markdown__editor')) {
      let editor = field.matches('input,textarea,[contenteditable]') ? field : field.querySelector('input,textarea,[role="textbox"]');
      if (!editor) {
        editor = doc.createElement('span');
        editor.className = 'kanso-field__editor';
        for (const child of [...field.childNodes]) {
          if (child.nodeType === 3 || (child.nodeType === 1 && !child.matches('svg,[tabindex],.kanso-button--icon,.kanso-search__count'))) editor.append(child);
        }
        field.prepend(editor);
      }
      if (!editor.matches('input,textarea')) {
        editor.contentEditable = disabled(field) ? 'false' : 'true';
        editor.setAttribute('role', 'textbox');
        editor.setAttribute('aria-multiline', String(field.classList.contains('kanso-field--multiline')));
      }
      editor.setAttribute('aria-label', editor.getAttribute('aria-label') || field.getAttribute('aria-label') || field.previousElementSibling?.textContent || 'Text');
      editor.setAttribute('aria-invalid', String(field.classList.contains('kanso-field--invalid')));
      if (editor !== field) field.tabIndex = -1;
    }
    for (const group of scope.querySelectorAll(groups)) {
      group.setAttribute('role', 'group');
      for (const item of group.children) {
        if (item.matches('svg,.kanso-layout__grow')) continue;
        item.setAttribute('role', 'button');
        item.tabIndex = disabled(item) ? -1 : 0;
        item.setAttribute('aria-pressed', String(item.classList.contains('kanso-control--on')));
      }
    }
    for (const node of scope.querySelectorAll(selector)) {
      const kind = Object.entries(behaviours).find(([name]) => node.classList.contains(name))?.[1];
      if (['animate', 'surface', 'field', 'select'].includes(kind) || node.closest('.kanso-skeleton__list')) continue;
      if (!node.hasAttribute('tabindex')) node.tabIndex = disabled(node) ? -1 : 0;
      if (!node.hasAttribute('role') && !node.matches('button,a,input,textarea')) node.setAttribute('role', node.matches('.kanso-menu-item') ? 'menuitem' : kind === 'toggle' ? 'switch' : 'button');
      if (kind === 'toggle') node.setAttribute('aria-checked', String(node.classList.contains('kanso-control--on')));
      if (kind === 'fold') node.setAttribute('aria-expanded', 'true');
      if (node.matches('.kanso-action,.kanso-button--armed')) remember(node);
    }
    for (const ghost of scope.querySelectorAll('.kanso-skeleton:not(.kanso-skeleton--sweep)')) ghost.classList.add('kanso-skeleton--breathing');
  };
  const surfaceFor = (kind, label) => {
    const candidates = statesFor(kind === 'menu' ? 'Primitives/Menu' : 'Primitives/Dialog');
    const query = normal(label).replace(/^(new|open|show) /, '');
    const fixture = candidates.find((item) => normal(item.label) === normal(label))
      ?? candidates.find((item) => normal(item.label).endsWith(` · ${normal(label)}`))
      ?? candidates.find((item) => normal(item.label).includes(query))
      ?? candidates.find((item) => item.label === (kind === 'menu' ? 'Default' : 'Dialog')) ?? candidates[0];
    const holder = doc.createElement('div');
    holder.innerHTML = content(fixture.markup);
    const surface = holder.querySelector(surfaces);
    surface.classList.add('kanso-story__overlay');
    surface.setAttribute('role', kind === 'menu' ? 'menu' : 'dialog');
    surface.setAttribute('aria-label', label);
    root.append(surface);
    prepare(surface);
    return surface;
  };
  const confirm = (node) => {
    const label = node.querySelector('span')?.textContent || labelOf(node).replace(/Press again to .*/i, '').trim() || 'Action';
    const target = node.closest('.kanso-row,.kanso-row--two-lines,.kanso-worktree,.kanso-sidebar__row') ?? node;
    target.hidden = true;
    disarm();
    status(`${label} confirmed in sample data`, () => { target.hidden = false; node.focus(); });
  };
  const arm = (node) => {
    if (armed === node) { confirm(node); return; }
    disarm();
    remember(node);
    if (!node.classList.contains('kanso-action')) {
      const label = labelOf(node);
      node.replaceChildren();
      for (const text of [label, `Press again to ${label.toLowerCase()}`]) {
        const span = doc.createElement('span');
        span.textContent = text;
        node.append(span);
      }
      node.classList.add('kanso-action');
    }
    node.classList.add('kanso-action--armed');
    node.setAttribute('aria-label', node.lastElementChild.textContent);
    armed = node;
    armTimer = setTimeout(() => { if (armed === node) disarm(); }, ARM_MS);
  };
  const select = (node) => {
    const group = node.closest(groups) ?? node.parentElement;
    const item = node.closest(groups) ? [...group.children].find((child) => child === node || child.contains(node)) : node;
    if (!item || disabled(item)) return;
    for (const sibling of group.children) {
      sibling.classList.toggle('kanso-control--on', sibling === item);
      sibling.setAttribute('aria-pressed', String(sibling === item));
    }
    chooseState(labelOf(item));
  };
  const fold = (node) => {
    const expanded = node.getAttribute('aria-expanded') !== 'false';
    node.setAttribute('aria-expanded', String(!expanded));
    const children = node.matches('.kanso-sidebar__section') ? [...node.children].slice(1) : [];
    if (!children.length) {
      for (let next = node.nextElementSibling; next && !next.matches('.kanso-section,.kanso-section--collapsible,.kanso-sidebar__section,.kanso-sidebar__group'); next = next.nextElementSibling) children.push(next);
    }
    for (const child of children) child.hidden = expanded;
  };
  const action = (node) => {
    const label = labelOf(node), icon = node.querySelector('use')?.getAttribute('href') ?? '';
    if (/panel-left/.test(icon) || /sidebar/i.test(label)) {
      if (chooseState(node.closest('.kanso-rail') ? 'Open' : 'Collapsed')) return;
      const navigation = node.closest('.kanso-sidebar,.kanso-sidebar--standalone,.kanso-rail');
      navigation?.classList.toggle('kanso-sidebar--collapsed');
      return;
    }
    const surface = node.closest(surfaces);
    if (/^(cancel|close|done)$/i.test(label) || /#lu-x$/.test(icon)) { if (surface) close(surface, true); return; }
    if (/^copy|#lu-copy/.test(label.toLowerCase() + icon)) {
      const value = node.closest('.kanso-code,.kanso-log,.kanso-row')?.textContent ?? label;
      const clipboard = doc.defaultView.navigator.clipboard;
      if (clipboard?.writeText) clipboard.writeText(value).then(() => status('Copied'), () => status('Copy unavailable; select the sample text'));
      else status('Copy unavailable; select the sample text');
      return;
    }
    if (/#lu-chevron-(up|down)/.test(icon)) {
      const hits = [...root.querySelectorAll('.kanso-search__hit')].filter((hit) => !hit.hidden);
      if (hits.length) {
        const index = hits.findIndex((hit) => hit.classList.contains('kanso-row--selected'));
        const next = (index + (icon.endsWith('up') ? -1 : 1) + hits.length) % hits.length;
        handlers.row(hits[next]);
        hits[next].focus();
        const counter = root.querySelector('.kanso-search__count');
        if (counter) counter.textContent = `${next + 1} of ${hits.length}`;
        return;
      }
    }
    if (/^(remove|delete|reset|restart|stop|kill|merge|overwrite|forget|clear|close tab)\b/i.test(label) || node.matches('.kanso-action,.kanso-button--armed')) { arm(node); return; }
    if (chooseState(label)) return;
    if (/settings|#lu-settings/.test(label.toLowerCase() + icon) && chooseState('Settings: sources and plans, detected')) return;
    const kind = /menu|picker|sort|more|#lu-(ellipsis|settings|arrow-up-down)/i.test(label + icon) ? 'menu'
      : /^(new|create|add|rename|open with|send|share)\b|#lu-(plus|share|send)/i.test(label + icon) && !surface ? 'dialog' : null;
    if (kind) {
      const existing = [...overlays].find(([, trigger]) => trigger === node)?.[0];
      if (existing && !existing.hidden) close(existing, true);
      else open(existing ?? surfaceFor(kind, label), node);
      return;
    }
    if (surface) {
      if (surface.matches('.kanso-menu')) { node.classList.add('kanso-control--on'); close(surface, true); }
      else {
        const fields = [...surface.querySelectorAll('[role="textbox"],input,textarea')];
        const invalid = fields.find((field) => !editorValue(field));
        if (invalid) { invalid.closest('.kanso-field')?.classList.add('kanso-field--invalid'); invalid.setAttribute('aria-invalid', 'true'); invalid.focus(); return; }
        close(surface, true);
      }
    }
    status(`${label} applied to sample data`);
  };
  const handlers = {
    select, action, armed: arm, fold,
    toggle(node) {
      const pill = node.matches('.kanso-switch') ? node : node.querySelector('.kanso-switch');
      if (!pill) return;
      const on = pill.classList.toggle('kanso-control--on');
      pill.setAttribute('aria-checked', String(on));
    },
    field(node) { (node.querySelector('[role="textbox"],input,textarea') ?? node).focus(); },
    row(node) {
      for (const sibling of node.parentElement.children) {
        sibling.classList.toggle('kanso-row--selected', sibling === node);
        if (sibling.hasAttribute('tabindex')) sibling.setAttribute('aria-pressed', String(sibling === node));
      }
    },
    drag(node) { node.classList.toggle('kanso-control--active'); },
    replay(node) { for (const animation of node.parentElement.getAnimations({ subtree: true })) { animation.cancel(); animation.play(); } },
    annotate(node, event) {
      const point = doc.createElement('button');
      point.className = 'kanso-simulator__note-point';
      point.textContent = String(node.querySelectorAll('.kanso-simulator__note-point').length + 1);
      point.style.cssText = `position:absolute;left:${event.offsetX}px;top:${event.offsetY}px`;
      node.append(point);
    },
    surface() {}, animate() {},
  };
  const control = (target) => {
    const group = target.closest(groups);
    const node = target.closest(selector);
    if (group && (!node || node === group)) return { node: target, kind: 'select' };
    if (!node || !root.contains(node)) return {};
    const kind = Object.entries(behaviours).find(([name]) => node.classList.contains(name))?.[1];
    return { node, kind };
  };
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: abort.signal });
  prepare(root);
  for (const surface of root.querySelectorAll(surfaces)) {
    if (surface.parentElement.closest(surfaces)) continue;
    surface.setAttribute('role', surface.matches('.kanso-menu') ? 'menu' : 'dialog');
    if (inlineSurfaces) continue;
    const trigger = doc.createElement('button');
    trigger.className = 'kanso-button--tonal';
    trigger.type = 'button';
    trigger.textContent = surface.matches('.kanso-menu') ? 'Open menu' : 'Open dialog';
    trigger.setAttribute('aria-haspopup', surface.matches('.kanso-menu') ? 'menu' : 'dialog');
    trigger.setAttribute('aria-expanded', 'true');
    surface.before(trigger);
    overlays.set(surface, trigger);
    triggers.set(trigger, surface);
  }
  on(root, 'click', (event) => {
    const { node, kind } = control(event.target);
    if (!node) return;
    if (node.matches('a.kanso-reference__link')) return;
    if (!event.target.closest('[contenteditable="true"],input,textarea')) event.preventDefault();
    if (disabled(node)) return;
    if (triggers.has(node)) {
      const surface = triggers.get(node);
      surface.hidden ? open(surface, node) : close(surface, true);
      return;
    }
    if (node.closest('.kanso-story__feedback') && undoAction) {
      const undo = undoAction;
      undoAction = null;
      undo();
      root.querySelector('.kanso-story__feedback')?.remove();
      return;
    }
    if (armed && armed !== node) disarm();
    handlers[kind](node, event);
  });
  on(root, 'focusin', (event) => event.target.closest('.kanso-field')?.classList.add('kanso-control--focus'));
  on(root, 'focusout', (event) => {
    const field = event.target.closest('.kanso-field');
    if (field && !field.contains(event.relatedTarget)) field.classList.remove('kanso-control--focus');
  });
  on(root, 'input', (event) => {
    const field = event.target.closest('.kanso-field,.kanso-field--search');
    if (!field || disabled(field)) return;
    const query = normal(editorValue(event.target));
    const search = field.matches('.kanso-field--search') || field.querySelector('use[href="#lu-search"]') || /find|search|filter/i.test(event.target.getAttribute('aria-label') ?? '') || page === 'Panels/Find';
    const invalid = !query && !search;
    field.classList.toggle('kanso-field--invalid', invalid);
    event.target.setAttribute('aria-invalid', String(invalid));
    const scope = field.closest(`${surfaces},.kanso-panel,.kanso-settings`) ?? root;
    if (!search) return;
    const rows = [...scope.querySelectorAll('.kanso-search__hit,.kanso-row,.kanso-row--two-lines,.kanso-dialog__row,.kanso-sidebar__row')].filter((row) => !row.contains(field) && !row.closest('.kanso-skeleton__list'));
    let count = 0;
    for (const row of rows) { row.hidden = !normal(row.textContent).includes(query); if (!row.hidden) count++; }
    const counter = scope.querySelector('.kanso-search__count');
    if (counter) counter.textContent = `${count} ${count === 1 ? 'match' : 'matches'}`;
  });
  on(root, 'keydown', (event) => {
    const { node } = control(event.target);
    if (!node || disabled(node)) return;
    const menu = node.closest('.kanso-menu');
    const group = node.closest(groups);
    if ((menu || group) && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && !event.target.matches('[role="textbox"],input,textarea')) {
      event.preventDefault();
      const items = [...(menu ? menu.querySelectorAll('.kanso-menu-item') : group.children)].filter((item) => !disabled(item) && !item.hidden && item.matches('[tabindex]'));
      const index = items.findIndex((item) => item === node || item.contains(node));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (/Up|Left/.test(event.key) ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
      if (group && items[next]) select(items[next]);
    } else if (['Enter', ' '].includes(event.key) && !event.target.matches('[role="textbox"],input,textarea,[contenteditable="true"]') && !node.matches('button,a')) {
      event.preventDefault();
      node.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    } else if (event.key === 'Enter' && event.target.getAttribute('aria-multiline') === 'false') {
      event.preventDefault();
      if (editorValue(event.target)) event.target.blur();
    }
  });
  on(doc, 'keydown', (event) => {
    if (event.key !== 'Escape') return;
    disarm();
    for (const surface of overlays.keys()) if (!surface.hidden) close(surface, true);
  });
  on(doc, 'click', (event) => {
    for (const [surface, trigger] of overlays) if (!surface.hidden && !surface.contains(event.target) && !trigger?.contains(event.target)) close(surface);
  });
  return () => {
    abort.abort();
    disarm();
    overlays.clear();
  };
}
