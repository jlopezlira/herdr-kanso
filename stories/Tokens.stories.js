import tokens from '../kanso/tokens.json';
import { elements } from './elements.json';
import folder from '../kanso/mods/kanso-chrome/icons/folder.svg?raw';
import { docs, escape, html, icon } from './docs';

const guidance = elements.find((e) => e.id === 'tokens');
const files = guidance.files.map((f) => `- \`${f.path}\`: ${f.role}`).join('\n');
const component = `${docs(guidance.use.join(' '), guidance.avoid.join(' '), 'kanso').parameters.docs.description.component}

## How to use it

${files}

\`\`\`
${guidance.agent}
\`\`\``;
export default {
  title: 'Tokens',
  tags: ['autodocs'],
  parameters: { docs: { description: { component } } },
};

const details = (t) => `<div><code>--${escape(t.name)}</code><div>${escape(t.value)}</div><p>${escape(t.role)}</p></div>`;
const scale = (group, sample) => html(`<div class="story-stack">${tokens[group].map((t) =>
  `<div class="token-row">${details(t)}${sample(t)}</div>`).join('')}</div>`);
const box = (t, property) => `<div class="token-box" style="${property}:var(--${t.name})"></div>`;

const colourWhy = `### Colour guidelines

- **Seijaku** Use a token, never a value. Every colour in a board or a mod is one of the tokens in the table. A new colour is added to the table, with its use and its rule, before anything uses it.
- **Shizen** Text passes 4.5:1 on every surface it can sit on, including hover and selected. Marks, focus rings and control edges pass 3:1. Never lower contrast with opacity on text.
- **Fukinsei** Three text levels: fg, muted and dim, told apart by size and place first and tone second.
- **Kokō** One colour, one meaning. A state colour appears only on the thing in that state. Colour on anything that asks nothing is a defect.
- **Shizen** Washes come from the foreground: track 4%, hover 7%, selected 12%, active project 14%. Light uses the same steps; it never reaches pure white or black.
- **Seijaku** Light and dark are one design. They share the same geometry and the same token names; only the values differ.
- **Seijaku** Checking a change. Any change to a token is measured against every surface in the table, hover and selected included, before it is published.`;

const colourWhyHtml = colourWhy.split('\n').reduce((out, line) => {
  const text = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  if (line.startsWith('### ')) return `${out}<h3>${text.slice(4)}</h3><ul>`;
  if (line.startsWith('- ')) return `${out}<li>${text.slice(2)}</li>`;
  return out;
}, '') + '</ul>';

export const Colours = {
  render: () => html(`<div><div class="story-stack">${tokens.colour.dark.map((dark) => {
    const light = tokens.colour.light.find((t) => t.name === dark.name);
    const property = dark.name === 'shadow' ? 'box-shadow' : 'background';
    return `<section class="colour-sample"><h2><code>--${escape(dark.name)}</code></h2><p>${escape(dark.role)}</p><div>dark ${escape(dark.value)}</div><div>light ${escape(light.value)}</div><div class="swatch" style="${property}:var(--${dark.name})"></div></section>`;
  }).join('')}</div>${colourWhyHtml}</div>`),
};
export const Type = {
  render: () => scale('type', (t) => {
    const property = t.name.startsWith('k-fs-') ? 'font-size' : t.name.startsWith('k-fw-') ? 'font-weight' : 'line-height';
    return `<span style="${property}:var(--${t.name})"${t.name === 'k-fs-mono' ? ' class="mono"' : ''}>kansō</span>`;
  }),
};
export const Space = { render: () => scale('space', (t) => box(t, 'width')) };
export const Radius = { render: () => scale('radius', (t) => box(t, 'border-radius')) };
export const Heights = { render: () => scale('height', (t) => box(t, 'height')) };
export const Icons = { render: () => scale('icon', (t) => `<span class="token-icon" style="width:var(--${t.name});height:var(--${t.name})">${icon(folder)}</span>`) };
export const SwitchSizes = { render: () => scale('switch', (t) => box(t, t.name === 'k-sw-w' ? 'width' : 'height')) };
export const Motion = { render: () => scale('motion', () => '') };
