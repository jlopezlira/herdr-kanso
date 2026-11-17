import { content, featuresFor } from './catalog.js';

export function promptFor(page, states) {
  const html = states.map((state) => content(state.markup)).join('');
  const classes = [...new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)))].filter((name) => !/^kanso-(story|prototype)/.test(name)).sort();
  const names = page.startsWith('Tokens/') ? /class="kanso-tokens__name">(--[\w-]+)/g : /var\((--[\w-]+)/g;
  const tokens = [...new Set([...html.matchAll(names)].map((match) => match[1]))].sort();
  const references = tokens.length ? [`Use these token references: ${tokens.join(', ')}.`] : [];
  if (page.startsWith('Tokens/')) return [
    `Use ${page} from kanso/tokens.json by role.`,
    'Load site/tokens.css. Use the global dark or light theme.',
    ...references,
  ].join('\n');
  return [
    `Build ${page} for kansō from the shared kit.`,
    'Read this page in stories/catalog.json with expand() from scripts/storybook-catalog.mjs and reuse its shared fragments.',
    'Read kanso/tokens.json by role. Load site/tokens.css, stories/proto.css and stories/proto-sprite.svg. Use the global dark or light theme.',
    ...(classes.length ? [`Reuse these kit classes: ${classes.join(', ')}.`] : []),
    ...references,
    ...(html.includes('kanso-explain') ? ['Build Explain actions with explainButton(target) from scripts/storybook-components.mjs: tonal, Lucide bot icon, and a named destination.'] : []),
    ...(featuresFor(page).some((feature) => feature.gap) ? ['The Not designed yet list describes existing features awaiting a simplified experience. Preserve their behavior and design those states from this kit before adding drawings.'] : []),
    `Keep one ${page.split('/').at(-1)} component. Expose the documented states as modifiers or data; compose shared primitives instead of duplicating their markup or CSS.`,
    'Preserve geometry, keyboard focus and reduced-motion behavior. A hover or focus change must not move the box. Keep the last successful content during a refresh failure, with the recovery action beside the original failure words.',
    'Use the shared four-second Armed control for irreversible actions. Apply the specifications and guidelines on this page.',
  ].join('\n');
}
