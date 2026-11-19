// What the pull request pages share: pull request 142 opened on a verdict, its details, its pickers and its pages, as props of the panel.
import { samplePull, samplePullPages } from './panel-samples.js';

export const { verdicts, refusals, thread: talkSample, answers, events, details: detailSample, review: reviewSample } = samplePull;
export const openedPull = (verdict = verdicts.failed, extra = {}) => ({ page: 'pr', number: verdict.number ?? samplePull.number, title: verdict.title ?? samplePull.title, agent: verdict.agent ?? samplePull.agent, verdict, details: { summary: detailSample.summary }, ...extra });
export const failedActs = ['explain', 'log', 'github'];
export const talked = (extra = {}) => openedPull(verdicts.failed, { acts: failedActs, talk: { thread: talkSample, ...extra } });
export const { cut: filesCut, moreChecks, ...detailsShown } = detailSample;
export const detailed = (extra = {}) => openedPull(verdicts.failed, { acts: failedActs, scope: samplePull.branch, details: { ...detailsShown, open: true, ...extra } });
export const person = (checked, extra = {}) => ({ name, second }) => ({ label: name, second, checked: checked.includes(name), ...extra });
export const { people, labels, notes } = samplePullPages;
export const picker = (title, items) => ({ ...detailed(), picker: { title, items: [{ field: 'Find' }, ...items] } });
export const reviewers = (checked) => people.slice(0, 3).map(person(checked));
export const pageOf = (page, { file, facts: said, ...rest }, extra = {}) => ({ page, file, facts: said, back: samplePull.number, ...rest, ...extra });
