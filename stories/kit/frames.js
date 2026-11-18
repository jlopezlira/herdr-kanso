// Story frames shared by the catalog script and the playgrounds: a bar or a strip at one of the kit's widths, each width a frame class on tokens.
import { statusBar } from './compositions.js';

export const barWidths = [1200, 1040, 760, 520];
const width = (value) => {
  if (!barWidths.includes(value)) throw new Error(`frames: unknown width ${value}`);
  return `kanso-story--w${value}`;
};
export const atWidth = (value, markup) => `<div class="kanso-story__bar ${width(value)}">${markup}</div>`;
export const inStrip = (value, markup) => `<div class="kanso-story__strip ${width(value)}">${markup}</div>`;
export const inBar = (value, parts) => atWidth(value, statusBar(parts));
export const toolsRoom = (markup) => `<div class="kanso-story__tools-room">${markup}</div>`;
