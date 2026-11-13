import { addons } from 'storybook/preview-api';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import sprite from '../stories/proto-sprite.svg?raw';
import '../site/tokens.css';
import '../stories/proto.css';
import '../stories/frame.css';

document.body.insertAdjacentHTML('afterbegin', sprite);

const applyTheme = (theme) => {
  if (theme) document.documentElement.dataset.theme = theme;
};
addons.ready().then((channel) => {
  channel.on(SET_GLOBALS, ({ globals }) => applyTheme(globals.theme));
  channel.on(GLOBALS_UPDATED, ({ globals }) => applyTheme(globals.theme));
});

/** @type { import('@storybook/html-vite').Preview } */
const preview = {
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: { title: 'Theme', items: ['dark', 'light'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark' },
  decorators: [(story, context) => {
    applyTheme(context.globals.theme);
    const frame = document.createElement('div');
    frame.className = context.viewMode === 'story' ? 'kanso-story__viewport kanso-story--canvas' : 'kanso-story__viewport';
    const content = story();
    if (typeof content === 'string') frame.innerHTML = content;
    else frame.append(content);
    return frame;
  }],
  parameters: {
    options: {
      storySort: {
        order: [
          'Start', ['Philosophy', 'About', 'How to read this Storybook', 'How to use the prompt for agents'],
          'Tokens', ['Colour', 'Type', 'Spacing', 'Radius', 'Motion', 'Icons'],
          'Primitives',
          'Compositions', ['Header', 'Sidebar', 'Rail', 'Status bar', 'Bars', 'Edge and Minimap', 'State patterns'],
          'Panels',
          'Layouts',
        ],
      },
    },
    backgrounds: { disabled: true },
    a11y: { test: 'todo' },
  },
};

export default preview;
