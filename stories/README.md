# Storybook

The Storybook is the design source for kansō: every component, its states and the rules a build must keep.

## Run

- `npm run storybook`: dev server at http://localhost:6006, MCP at http://localhost:6006/mcp.
- `npm run build-storybook`: static build plus `storybook-static/manifests/docs.json`, every page as text.
- `npm run build:stories`: regenerates the component pages, the reference pages and `GAPS.md` from the catalog.
- `npm run lint:storybook` and `npm test`: structure, BEM classes, tokens, names and icons.

## Where things are

| Path | What it holds |
| --- | --- |
| `catalog.json` | Every state drawing (markup, caption, specification, source location), packed. Generated; never edit by hand. |
| `references.json` | One entry per named page: its reference codes, status (Approved reference or Proposed), guidelines, the catalog states it shows, and source predicates that differ from the code (`proposedPredicates`). |
| `components/` | One `.stories.js` and one `.mdx` per component. |
| `references/` | Generated `.mdx` for each named page in `references.json`. |
| `start/` | The Start pages. |
| `kit/` | The page renderers (`ComponentPage.jsx`, `ReferencePage.jsx`), the one-sentence `descriptions.js` and the prompt builder. |
| `proto.css`, `frame.css`, `proto-sprite.svg` | Drawing styles and the icon sprite. |
| `GAPS.md` | Generated list of app features with no drawing yet. Lint fails if it differs from the catalog. |

## How a page is built

- A component page is `components/<section>-<name>.mdx` rendering `ComponentPage`: the title, its sentence from `kit/descriptions.js`, the approved drawings, the states with their specifications, then **Prompt for agents** and **Not designed yet**.
- A named page is generated from `references.json` and renders `ReferencePage`: status, guidelines, the drawings, the components it uses and its prompt.
- A state belongs to one component page. Compositions reuse the primitive markup from the catalog; nothing is drawn twice.
- Guidelines hold only what a drawing cannot show: sizes, timings, exact words, costs. One rule, one place.

## Imports

- `scripts/import-approved.mjs <master.html>` imports the approved reference drawings and overwrites the guidelines of those pages from the master. Rewrite them after an import.
- `scripts/import-panels.mjs` and `scripts/import-proto.mjs` import panel and kit drawings into the catalog.

## Feature inventory

The catalog is the inventory: each feature state has its page, label and source location. To list it:

```sh
node -e 'import("./scripts/storybook-catalog.mjs").then(({expand})=>{for(const r of expand(require("./stories/catalog.json")))if(r.location)console.log([r.page,r.label,r.location].join(" | "))})'
```

## Open items

- 130 predicates differ from the code; their pages list them as Proposed. Reconcile them before claiming the app matches.
- Every UI action in each mod and every test still has to be checked against the catalog states. `GAPS.md` counts missing drawings only, not faithful coverage.
- Save arrangement shows segmented labels where the approved drawing shows the captured columns and panes, and its list lacks the approved rows and scope.
- Reference codes Q4a to Q4e are excluded.
