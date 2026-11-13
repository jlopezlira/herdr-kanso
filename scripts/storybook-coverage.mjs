import plans from './storybook-overlaps.json' with { type: 'json' };
import { FEATURE_LABEL, FEATURE_NOTE, GAP_TITLE } from '../stories/kit/features.js';

export function overlapFor(record) {
  if (record.source !== 'coverage') return;
  const [, file, component, ...state] = record.id.split('/');
  return plans[[file, component, ...state].join('/')] ?? plans[`${file}/${component}`];
}

export function mergeCoverage(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.map((record) => {
    const plan = overlapFor(record);
    if (!plan) return record;
    const { html, design, gap, ...feature } = record;
    const target = plan.states[record.id.split('/').slice(3).join('/')];
    const drawing = byId.get(target);
    return { ...feature, page: plan.page, ...(drawing?.html && drawing.page === plan.page ? { design: target } : { gap: true }) };
  });
}

export function gapDocument(records) {
  const gaps = records.filter((record) => record.gap).sort((a, b) => a.page.localeCompare(b.page) || a.id.localeCompare(b.id));
  const cell = (text) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [`# ${GAP_TITLE}`, '', FEATURE_NOTE, '', `${gaps.length} feature states await design. The component pages list them under Prompt for agents as ${FEATURE_LABEL}.`, '', '| Module | State | Source |', '| --- | --- | --- |', ...gaps.map((record) => `| ${cell(record.page)} | ${cell(record.label)} | ${record.location} |`), ''].join('\n');
}
