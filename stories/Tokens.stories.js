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

export const Colours = {
  render: () => html(`<div class="story-stack">${tokens.colour.dark.map((dark) => {
    const light = tokens.colour.light.find((t) => t.name === dark.name);
    return `<section><h2><code>--${dark.name}</code></h2><p>${escape(dark.role)}</p><div class="colour-pair">${[['dark', dark], ['light', light]].map(([theme, t]) => {
      const variables = tokens.colour[theme].map((t) => `--${t.name}:${t.value}`).join(';');
      const property = t.name === 'shadow' ? 'box-shadow' : 'background';
      return `<div class="colour-sample" style="${escape(variables)}"><strong>${theme}</strong><div class="swatch" style="${property}:var(--${t.name})"></div><code>${escape(t.value)}</code></div>`;
    }).join('')}</div></section>`;
  }).join('')}</div>`),
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
