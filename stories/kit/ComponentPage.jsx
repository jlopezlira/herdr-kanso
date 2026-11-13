import React, { useState } from 'react';
import { ReferenceDrawings } from './ReferencePage.jsx';
import { referenceFor } from './references.js';
import { Canvas, Controls, Markdown, Source } from '@storybook/addon-docs/blocks';
import { content, featuresFor, statesFor } from './catalog.js';
import { descriptions } from './descriptions.js';
import { promptFor } from './prompt.js';
import { FEATURE_LABEL, FEATURE_NOTE } from './features.js';

export function ComponentPage({ of, page }) {
  const states = statesFor(page);
  const name = page.split('/')[1];
  const description = descriptions[name];
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const visible = states.filter((state) => `${state.label} ${content(state.caption)}`.toLowerCase().includes(query.toLowerCase()));
  const storyId = page.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '--variants';
  const prompt = promptFor(page, states);
  const gaps = featuresFor(page).filter((feature) => feature.gap);
  const contexts = [...new Set([...states, ...featuresFor(page)].flatMap((state) => state.context === undefined ? [] : [state.context]))];
  const notes = [...new Set(states.flatMap((state) => state.notes ?? []))];
  return <article className="kanso-docs">
    <h1>{name}</h1>
    <p>{description}</p>
    {referenceFor(page)?.approvedRecords?.length > 0 && <><h2>Approved reference</h2><ReferenceDrawings page={page} /></>}
    {contexts.length > 0 && <><h2>Usage details</h2>{contexts.map((id) => <p key={id}>{content(id)}</p>)}</>}
    <h2>States</h2>
    <Canvas of={of.Variants} />
    <Controls of={of.Variants} />
    <label className="kanso-docs__filter">Find a state<input className="kanso-field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <p>{visible.length} of {states.length} variants</p>
    <table><thead><tr><th>Variant</th><th>When shown</th><th>Specification</th></tr></thead>
      <tbody>{visible.map((state) => <tr key={state.id}>
        <td><a target="_top" href={`./?path=/story/${storyId}&args=state:${state.value}`}>{state.label}</a></td><td>{content(state.caption)}</td>
        <td>{state.spec ? <dl>{state.spec.map(([label, value]) => <React.Fragment key={label}><dt>{content(label)}</dt><dd>{content(value)}</dd></React.Fragment>)}</dl> : null}{state.location && <p>Source: <code>{state.location}</code></p>}{state.coverage.length > 0 && <ul>{state.coverage.map((feature) => <li key={feature.id}>{feature.label}: {content(feature.caption)} <code>{feature.location}</code></li>)}</ul>}</td>
      </tr>)}</tbody>
    </table>
    {notes.length > 0 && <><h2>Guidelines</h2>{notes.map((id) => <Markdown className="kanso-docs__note" key={id}>{content(id)}</Markdown>)}</>}
    <h2>Prompt for agents</h2>
    <button className="kanso-button" type="button" onClick={async () => { await navigator.clipboard.writeText(prompt); setCopied(true); }}>{copied ? 'Copied' : 'Copy prompt'}</button>
    <Source code={prompt} language="text" />
    {gaps.length > 0 && <><h3>{FEATURE_LABEL}</h3><p>{FEATURE_NOTE}</p><ul>{gaps.map((feature) => <li key={feature.id}>{feature.label}: {content(feature.caption)} <code>{feature.location}</code></li>)}</ul></>}
  </article>;
}
