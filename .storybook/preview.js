import { addons } from 'storybook/preview-api';
import '../site/tokens.css';
import '../stories/kit.css';

const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme || 'dark';
};

if (typeof window !== 'undefined') {
  applyTheme('dark');
  addons.getChannel().on('globalsUpdated', ({ globals }) => applyTheme(globals?.theme));
}

/** @type { import('@storybook/html-vite').Preview } */
const preview = {
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: { title: 'Theme', items: ['dark', 'light'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark' },
  decorators: [
    (story, context) => {
      applyTheme(context.globals.theme);
      return story();
    },
    (story) => {
      const room = document.createElement('div');
      room.style.padding = '10%';
      room.append(story());
      return room;
    },
  ],
  parameters: {
    options: {
      storySort: {
        order: ['Philosophy', 'Tokens', '*'],
        method: 'alphabetical',
      },
    },
    backgrounds: { disabled: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'todo' },
  },
};

export default preview;
