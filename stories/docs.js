import { elements } from '../site/guidelines/elements.json';

export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export function docs(use, avoid, principle = 'seijaku') {
  const p = elements.find((e) => e.id === 'philosophy').principles.find((p) => p.id === principle);
  return {
    parameters: {
      docs: { description: { component: `Use: ${use}\n\nAvoid: ${avoid}\n\nPrinciple: ${p.name}. ${p.means} ${p.applies}` } },
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
