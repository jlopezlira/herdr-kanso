# Storybook

The Storybook is the build guide for kansō: every piece, its states and the rules a build must keep.

## Run

- `npm run storybook`: dev server at http://localhost:6006, MCP at http://localhost:6006/mcp.
- `npm run build-storybook`: static build plus `storybook-static/manifests/docs.json`, every page as text.
- `npm run build:stories`: regenerates the component pages and `GAPS.md` from the catalog.
- `npm run lint:storybook` and `npm test`: structure, BEM classes, tokens, names and icons.

## Where things are

| Path | What it holds |
| --- | --- |
| `catalog.json` | Every state drawing (markup, caption, specification, source location), packed. Generated; never edit by hand. |
| `components/` | One `.stories.js` and one `.mdx` per piece. |
| `start/` | The one Start page. |
| `kit/` | The page renderer (`ComponentPage.jsx`), the one-sentence `descriptions.js`, the rules per page (`guidelines.js`, `rules.js`) and the prompt builder. |
| `proto.css`, `frame.css`, `proto-sprite.svg` | Drawing styles and the icon sprite. |
| `GAPS.md` | Generated list of app features with no drawing yet. Lint fails if it differs from the catalog. |

## How a page is built

- A page is `components/<section>-<name>.mdx` rendering `ComponentPage`: the title, its sentence from `kit/descriptions.js`, the states as variants with their specifications, the guidelines, then **Prompt for agents** and **Not designed yet**.
- A state belongs to one page. Compositions reuse the primitive markup from the kit; nothing is drawn twice.
- Guidelines hold only what a drawing cannot show: sizes, timings, exact words, costs. One rule, one line, one place.

## Imports

- `scripts/import-panels.mjs` and `scripts/import-proto.mjs` import panel and kit drawings into the catalog.

## Feature inventory

The catalog is the inventory: each feature state has its page, label and source location. To list it:

```sh
node -e 'import("./scripts/storybook-catalog.mjs").then(({expand})=>{for(const r of expand(require("./stories/catalog.json")))if(r.location)console.log([r.page,r.label,r.location].join(" | "))})'
```

## Open items

- Every UI action in each mod and every test still has to be checked against the catalog states. `GAPS.md` counts missing drawings only, not faithful coverage.
- Save arrangement shows segmented labels where the approved drawing shows the captured columns and panes, and its list lacks the approved rows and scope.
