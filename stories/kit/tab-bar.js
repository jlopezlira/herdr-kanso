import { button, grow, menu, plus, stack, tabSkeleton, tabs } from './kit.js';

export const tabBarStates = ['connected', 'connecting', 'unreachable'];
export const tabBar = ({ items = [], value = null, folded = [], overflow = false, panels = [], panel = null, state = 'connected', arrange = true, help = false, tips = {}, windows = false, focus = '' } = {}) => {
  const connected = state === 'connected';
  const door = (icon, label, { active = false, name = '', held = false } = {}) => button({ label, kind: icon ? 'icon' : 'quiet', icon: icon || 'none', active, tip: tips[label] ?? '', name, held, focus: focus === label });
  const insertion = () => stack({ variant: 'tab bar insertion' });
  const panelDoor = (item) => {
    const drawn = door(item.icon, item.label, { active: item.key === panel, name: `panel:${item.key}`, held: Boolean(item.held) });
    return item.drop === 'after' ? [drawn, insertion()] : item.drop ? [insertion(), drawn] : [drawn];
  };
  const tabList = state === 'connecting' ? Array.from({ length: Math.max(items.length, 1) }, () => tabSkeleton())
    : tabs({ items: items.map((item) => ({ closable: true, ...item })), value, size: 'md', disabled: state === 'unreachable', label: true });
  const more = folded.length && connected ? stack({ variant: 'tab bar more' }, button({ label: plus(folded.length), kind: 'quiet', active: overflow }),
    overflow ? stack({ variant: 'tab bar menu' }, menu({ items: folded.map((item) => ({ key: item.key, label: item.label, mark: item.mark })) })) : null) : null;
  const tools = connected ? [door('lu-plus', 'New tab'), arrange ? door('lu-panels-top-left', 'Arrange') : null] : null;
  const right = connected ? panels.flatMap(panelDoor) : null;
  const own = help ? door('lu-circle-question-mark', 'kansō help') : null;
  const system = windows ? [door('lu-minus', 'Minimize'), door('lu-square', 'Maximize'), door('lu-x', 'Close')] : null;
  return stack({ variant: 'tab bar' }, tabList, more, tools, grow(), stack({ variant: 'tab bar doors' }, right, own, system));
};
