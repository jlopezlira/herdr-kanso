// Show named references with their catalog drawings and proposed additions.
import React, { useEffect, useRef, useState } from "react";
import { Markdown, Source } from "@storybook/addon-docs/blocks";
import { content } from "./catalog.js";
import { mountBehaviours } from "./behaviours.js";
import { referenceFor, referenceStates } from "./references.js";
import { promptFor } from "./prompt.js";

export function ReferenceDrawings({ page }) {
  const reference = referenceFor(page);
  const states = referenceStates(page);
  const approved = new Set(reference?.approvedRecords ?? []);
  const [selected, setSelected] = useState("all");
  const preview = useRef(null);
  const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const state = states.find((item) => item.id === selected);
  const shown = selected === "all" ? states.filter((item) => approved.has(item.id) || !approved.size) : state ? [state] : [];
  useEffect(() => {
    if (!preview.current) return;
    preview.current.innerHTML = shown.map((item) => `<section class="kanso-story__variant"><h3 class="kanso-story__variant-label">${approved.has(item.id) ? "" : "Proposed · "}${escape(item.label)}</h3>${content(item.markup)}</section>`).join("");
    return mountBehaviours(preview.current, { page: state?.page ?? states[0]?.page, state: state?.value, inlineSurfaces: true, updateArgs: ({ state: value }) => setSelected(states.find((item) => item.value === value)?.id ?? selected) });
  }, [page, selected]);
  if (!reference || !states.length) return null;
  return <>
    <label className="kanso-docs__filter">State<select className="kanso-field" value={selected} onChange={(event) => setSelected(event.target.value)}>
      <option value="all">{approved.size ? "All reference drawings" : "All proposed states"}</option>
      {approved.size > 0 && <optgroup label="Approved reference">{states.filter((item) => approved.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>}
      <optgroup label="Proposed additions">{states.filter((item) => !approved.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
    </select></label>
    <div className="kanso-story__viewport" ref={preview} />
    {reference.proposedPredicates?.length > 0 && <><h2>Proposed states</h2><p>These existing feature drawings are proposed additions. Their source predicates differ from main.</p><ul>{reference.proposedPredicates.map((item) => <li key={item.id}>{item.label} <code>{item.location}</code></li>)}</ul></>}
  </>;
}

export function ReferencePage({ page }) {
  const reference = referenceFor(page);
  const states = referenceStates(page);
  const [copied, setCopied] = useState(false);
  const prompt = [
    `Build ${page} for kansō from the shared kit.`,
    reference.status === "Proposed" ? "This design is Proposed and needs approval." : "Follow the approved reference drawings and guidelines below. Additional states are Proposed.",
    "Preserve every action. Use the shared kit tokens, primitives and state patterns.",
    ...reference.guidelines,
    ...(states.length ? [promptFor(states[0].page, states)] : []),
  ].join("\n\n");
  return <article className="kanso-docs">
    <h1>{page.split("/")[1]}</h1>
    <p>{reference.status}</p>
    {reference.boards.length > 0 && <p>Reference: {reference.boards.join(", ")}</p>}
    {reference.guidelines.map((note, index) => <Markdown key={index}>{note}</Markdown>)}
    <ReferenceDrawings page={page} />
    {reference.components.length > 0 && <><h2>Components</h2><ul>{reference.components.map((component) => <li key={component}><a href={`./?path=/docs/${component.toLowerCase().replace(/[^a-z0-9]+/g, "-")}--overview`}>{component.split("/")[1]}</a></li>)}</ul></>}
    <h2>Prompt for agents</h2>
    <button className="kanso-button" type="button" onClick={async () => { await navigator.clipboard.writeText(prompt); setCopied(true); }}>{copied ? "Copied" : "Copy prompt"}</button>
    <Source code={prompt} language="text" />
  </article>;
}
