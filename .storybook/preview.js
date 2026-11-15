import { addons, useArgs, useEffect } from 'storybook/preview-api';
import { mountBehaviours } from '../stories/kit/behaviours.js';
import { playgrounds } from '../stories/kit/playgrounds.js';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import sprite from '../stories/proto-sprite.svg?raw';
import '../site/tokens.css';
import '../stories/proto.css';
import '../stories/primitives.css';
import '../stories/compositions.css';
import '../stories/frame.css';
import '../stories/utilities.css';

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
    const [, updateArgs] = useArgs();
    applyTheme(context.globals.theme);
    const frame = document.createElement('div');
    frame.className = context.viewMode === 'story' ? 'kanso-story__viewport kanso-story--canvas' : 'kanso-story__viewport';
    const content = story();
    if (typeof content === 'string') frame.innerHTML = content;
    else frame.append(content);
    useEffect(() => playgrounds[context.title] ? undefined : mountBehaviours(frame, { page: context.title, state: context.args.state, updateArgs }), [frame]);
    return frame;
  }],
  parameters: {
    options: {
      storySort: {
        order: [
          'Start', ['Philosophy', 'About', 'One fact, one home'],
          'Tokens', ['Colour', 'Contrast, light and dark', 'Type', 'Spacing', 'Radius', 'Motion', 'Icons'],
          'Primitives',
          'Compositions', ['Header', 'Sidebar', 'Rail', 'Status bar', 'Bars', 'Edge and Minimap', 'State patterns'],
          'Features',
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
