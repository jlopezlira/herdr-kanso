import React, { useState } from 'react';
import { Canvas, Controls, Markdown } from '@storybook/addon-docs/blocks';
import { content, featuresFor, statesFor } from './catalog.js';
import { descriptions } from './descriptions.js';
import { guidelines, sections } from './guidelines.js';
import { hypotheses } from './hypotheses.js';
import { promptFor } from './prompt.js';
import { rules } from './rules.js';
import { FEATURE_LABEL, FEATURE_NOTE } from './features.js';
import { PageStatus } from './PageStatus.jsx';

export function ComponentPage({ of, page }) {
  const states = statesFor(page);
  const name = page.split('/').at(-1);
  const description = descriptions[page] ?? descriptions[name];
  const guidance = guidelines[page] ?? (page === 'Tokens/Sizes' ? guidelines['Tokens/Components'] : undefined);
  const [copied, setCopied] = useState(false);
  const prompt = promptFor(page, states);
  const gaps = featuresFor(page).filter((feature) => feature.gap);
  return <article className="kanso-docs">
    <h1>{name}</h1>
    <PageStatus page={page} />
    <p>{description}</p>
    <Canvas of={of.Variants} />
    <Controls of={of.Variants} />
    {(sections[page] ?? []).map(([title, text]) => <React.Fragment key={title}><h2>{title}</h2><Markdown>{text}</Markdown></React.Fragment>)}
    {guidance && <><h2>Design guidelines</h2><ul className="kanso-docs__guidelines">{guidance.map(([principle, rule, detail]) => <li key={rule}><span className="kanso-docs__principle">{principle}</span> <b>{rule}</b> <Markdown options={{ forceInline: true }}>{detail}</Markdown></li>)}</ul></>}
    {hypotheses[page] && <><h2>Hypotheses</h2><ul className="kanso-docs__guidelines">{hypotheses[page].map((item) => <Hypothesis key={item.change} {...item} />)}</ul></>}
    {rules[page] && <><h2>Guidelines</h2><ul className="kanso-docs__guidelines">{rules[page].map((rule) => <li key={rule}><Markdown options={{ forceInline: true }}>{rule}</Markdown></li>)}</ul></>}
    <h2>Prompt for agents</h2>
    <button className="kanso-button kanso-button--solid" type="button" onClick={async () => { await navigator.clipboard.writeText(prompt); setCopied(true); }}>{copied ? 'Copied' : 'Copy prompt'}</button>
    <pre className="kanso-docs__prompt">{prompt}</pre>
    {gaps.length > 0 && <><h3>{FEATURE_LABEL}</h3><p>{FEATURE_NOTE}</p><ul>{gaps.map((feature) => <Feature key={feature.id} {...feature} />)}</ul></>}
  </article>;
}

const Feature = ({ label, caption, location }) => <li>{label}: {content(caption)} <code>{location}</code></li>;

// One hypothesis on the shared template; none has a signal yet, so each says Unproven.
const Hypothesis = ({ change, today, why, question, believe, jobs, wrong, try: first, back }) => <li>
  <b>{change}</b> Unproven.<br />
  <em>Today</em> {today}<br />
  <em>Why it is there</em> {why}<br />
  <em>Question</em> {question}<br />
  <em>We believe</em> {believe}<br />
  <em>Each job goes to</em> {jobs.map(([job, home]) => `${job}: ${home}`).join('; ')}.<br />
  <em>Wrong if</em> {wrong}<br />
  <em>Try</em> {first}<br />
  <em>Return</em> {back}
</li>;
