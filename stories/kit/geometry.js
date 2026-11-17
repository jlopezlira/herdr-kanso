// Board and chart data: geometry a story passes as data attributes becomes the element's custom properties; a bare number is board pixels.
const SIDES = ['left', 'top', 'right', 'bottom', 'width', 'height', 'radius'];
const length = (value) => (Number.isFinite(Number(value)) ? `${value}px` : value);
const placed = (node) => SIDES.filter((side) => node.dataset[side] !== undefined);

export const applyGeometry = (root) => root.querySelectorAll(SIDES.map((side) => `[data-${side}]`).join(','))
  .forEach((node) => placed(node).forEach((side) => node.style.setProperty(`--kanso-${side}`, length(node.dataset[side]))));
