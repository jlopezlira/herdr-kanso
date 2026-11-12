import { docs, html } from './docs';

export default {
  title: 'Loading',
  tags: ['autodocs'],
  ...docs('One soft light per bar; a working name keeps its own glints. Bars keep their box; reduced motion shows the still bar.', 'Motion outside live work, or a loading state that changes the size or position of a box.', 'shizen'),
};

const note = '<p>With prefers-reduced-motion: reduce, bars stay still and the working name uses muted text without a glint.</p>';
export const SkeletonList = {
  render: () => html(`<div class="kst-panel"><div class="kit-skl" role="status" aria-label="Loading projects">${Array.from({ length: 3 }, () => '<div class="prow" aria-hidden="true"><span class="sk skw skeleton-icon"></span><div class="skeleton-text"><span class="sk skw skeleton-name"></span><span class="sk skw skeleton-meta"></span></div></div>').join('')}</div>${note}</div>`),
};
export const WorkingName = {
  render: () => html(`<div class="story-stack"><span class="kit-glint working-name">Working on project</span>${note}</div>`),
};
