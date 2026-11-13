

/** @type { import('@storybook/html-vite').StorybookConfig } */
const config = {
  "stories": [
    "../stories/**/*.mdx",
    "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp"
  ],
  "framework": "@storybook/html-vite",
  // A regenerated catalog changes the State options, so the preview reloads instead of patching.
  viteFinal: (config) => ({ ...config, plugins: [...(config.plugins ?? []), { name: 'kanso-catalog-reload', handleHotUpdate({ file, server }) { if (/stories\/(catalog\.json|proto\.css|frame\.css)$/.test(file)) { server.ws.send({ type: 'full-reload' }); return []; } } }] }),
  "features": {
    "componentsManifest": true
  },
  "core": {
    "disableWhatsNewNotifications": true,
    "disableTelemetry": true
  }
};
export default config;