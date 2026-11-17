import plans from './storybook-overlaps.json' with { type: 'json' };
import { FEATURE_LABEL, FEATURE_NOTE, GAP_TITLE } from '../stories/kit/features.js';

export function overlapFor(record) {
  if (record.source !== 'coverage') return;
  const [, file, component, ...state] = record.id.split('/');
  return plans[[file, component, ...state].join('/')] ?? plans[`${file}/${component}`];
}

// A page draws only its boards: a code state points at the board that draws it, or awaits design.
export function mergeCoverage(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.map((record) => {
    if (record.source !== 'coverage') return record;
    const { html, design, gap, ...feature } = record;
    const plan = overlapFor(record) ?? { page: record.page, states: {} };
    const target = plan.states[record.id.split('/').slice(3).join('/')];
    const drawing = byId.get(target);
    return { ...feature, page: plan.page, ...(drawing?.html && drawing.page === plan.page ? { design: target } : { gap: true }) };
  });
}

export function gapDocument(records) {
  const gaps = records.filter((record) => record.gap).sort((a, b) => a.page.localeCompare(b.page) || a.id.localeCompare(b.id));
  const cell = (text) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [`# ${GAP_TITLE}`, '', FEATURE_NOTE, '', `${gaps.length} feature states await design. Each page lists its own under ${FEATURE_LABEL}.`, '', '| Module | State | Source |', '| --- | --- | --- |', ...gaps.map((record) => `| ${cell(record.page)} | ${cell(record.label)} | ${record.location} |`), ''].join('\n');
}
