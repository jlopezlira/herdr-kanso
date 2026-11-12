import { elements } from './elements.json';

export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export const principle = (id) => {
  const p = elements.find((e) => e.id === 'philosophy').principles.find((p) => p.id === id);
  return `Principle: ${p.name}. ${p.means} ${p.applies}`;
};

export function docs(use, avoid, id = 'seijaku') {
  return {
    parameters: {
      docs: { description: { component: `Use: ${use}\n\nAvoid: ${avoid}\n\n${principle(id)}` } },
    },
  };
}

export const html = (markup) => {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.firstElementChild;
};

export const states = (render, names) => html(`<div class="story-stack">${names.map((state) =>
  `<div class="story-row"><span class="story-label">${state}</span>${render(state)}</div>`).join('')}</div>`);

export const icon = (svg, className = 'i') => svg.replace('<svg ', `<svg class="${className}" aria-hidden="true" `);
