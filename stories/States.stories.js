import folder from '../kanso/mods/kanso-chrome/icons/folder.svg?raw';
import check from '../kanso/mods/kanso-chrome/icons/check.svg?raw';
import { docs, html, icon } from './docs';

export default {
  title: 'States',
  tags: ['autodocs'],
  ...docs('One set of state blocks for failure, empty, pending and toast. State colour only on what asks for you.', 'A different drawing for each panel, or state colour on unrelated text.', 'koko'),
};

export const Failure = {
  render: () => html(`<div class="kst-panel"><div class="kst-block" role="alert">${icon(folder, 'm')}<div class="kst-what">Could not open project</div><div class="kst-why">The project folder is unavailable.</div><div class="kst-acts"><button type="button" class="kst-btn">Try again</button><button type="button" class="kst-btn">Choose folder</button></div></div></div>`),
};
export const Empty = {
  render: () => html(`<div class="kst-panel"><div class="kst-empty">${icon(folder)}<div class="t">No projects yet</div><button type="button" class="kst-btn">Open project</button></div></div>`),
};
export const Pending = {
  render: () => html('<div class="kst-panel"><div class="kst-line kst-pend" role="status"><span class="kst-pdot" aria-hidden="true"></span>Opening project</div></div>'),
};
export const Toast = {
  render: () => html(`<div class="kst-toast" role="status">${icon(check)}<span class="t"><b>Project opened</b></span><button type="button" class="kst-btn">Undo</button></div>`),
};
