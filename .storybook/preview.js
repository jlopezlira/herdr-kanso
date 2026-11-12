import { addons } from 'storybook/preview-api';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import sprite from '../stories/proto-sprite.svg?raw';
import '../site/tokens.css';
import '../stories/proto.css';

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
    frame.className = 'story-frame';
    const content = story();
    if (typeof content === 'string') frame.innerHTML = content;
    else frame.append(content);
    return frame;
  }],
  parameters: {
    options: {
      storySort: {
        order: [
          'Philosophy',
          'Tokens', ['How to use it', 'Every value', 'Type', 'Colour and wash', 'Icons', 'Dawn'],
          'Compositions', ['Controls', 'Sidebar rows', 'Panel pieces', 'States', 'Bars', 'Files and PR', 'Menu and dialog'],
          'Components', ['While you were away', 'Title and tools', 'Collapsed rail', 'New project', 'Menu', 'Dialog', 'Rename', 'Pick list', 'Markdown window', 'Settings tabs', 'Tab bar', 'Pane header', 'Status bar', 'Tab states', 'Panel menu', 'Header digest', 'Pane standing in', 'Edges and minimap', 'Status bar, working', 'Find in the conversation', 'System notification', 'Simulator screen', 'Annotated picture', 'Code', 'Markdown', 'Log', 'Shipped', 'Worktree row, open', 'New worktree', 'Choosing the channel'],
          'Layouts', ['Settings on Dawn', 'hjkl dōjō', 'Sidebar header, three ways', 'Sidebar at rest', 'Window at rest', 'Right-click any piece'],
        ],
      },
    },
    backgrounds: { disabled: true },
    a11y: { test: 'todo' },
  },
};

export default preview;
