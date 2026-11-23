// The sidebar's Toolbar: + names what it adds, then Sort, Search and Hide sidebar; collapsed, a column whose caret holds Sort and Search.
import { button, grow, phrase, stack } from './kit.js';

const tool = (icon, label) => button({ label, kind: 'icon', size: 'lg', icon });
// + names what it adds in the view on show.
export const addLabels = { spaces: 'New project', agents: 'New conversation', threads: 'New conversation' };
// A tool whose menu, open, hangs under it, or beside it in a column.
const menuTool = ({ variant, flags = {}, label, icon, tip = null, open }) => stack({ variant, ...flags },
  button({ label, kind: 'icon', size: 'lg', icon, tip, active: Boolean(open) }), open ? stack({ variant: 'toolbar menu' }, open) : null);
// Sort is quieter at its default. Proposed: `order`, the order in use, named in Sort's tooltip.
const sortTool = ({ sorted, menu: open, order }) => menuTool({ variant: 'toolbar sort', flags: { sorted }, label: 'Sort', icon: 'lu-arrow-up-down', tip: order ? phrase('Sort:', order) : null, open });
// Collapsed, the bar contracts: + and Show sidebar stay, Sort and Search fold under a caret.
const more = (open, sort) => stack({ variant: 'toolbar group', open }, tool(open ? 'lu-chevron-up' : 'lu-chevron-down', open ? 'Fewer tools' : 'More tools'), open ? [sortTool(sort), tool('lu-search', 'Search')] : null);
// `sortMenu` and `addMenu`: the open menus, drawn.
export const toolbar = ({ view = 'spaces', column = false, open = false, sorted = false, order = null, sortMenu = null, addMenu = null } = {}) => {
  const add = menuTool({ variant: 'toolbar add', label: addLabels[view], icon: 'lu-plus', open: addMenu });
  const sort = { sorted, menu: sortMenu, order };
  return column
    ? stack({ variant: 'toolbar', column }, add, tool('lu-panel-left', 'Show sidebar'), more(open, sort))
    : stack({ variant: 'toolbar' }, add, grow(), sortTool(sort), tool('lu-search', 'Search'), tool('lu-panel-left', 'Hide sidebar'));
};
