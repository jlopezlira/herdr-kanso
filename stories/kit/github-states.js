// The GitHub board's states: a folder of repositories first, then a pull request opened from its block, then each action as it goes. Every one is a proposal.
import { pullRequest } from './samples.js';
import { sampleAreas, sampleHidden, samplePull, samplePullPages } from './panel-samples.js';
import { sampleActions, sampleGithub } from './github-samples.js';
import { outcomeLine } from './github.js';
import { answers, detailed, detailSample, detailsShown, events, failedActs, openedPull, pageOf, picker, refusals, reviewers, reviewSample, talked, talkSample, verdicts } from './pull-states.js';

const { folder, noNeeds, one, everywhere, noRemote, statistics, contexts, looking, failure, oneFailed, stale, computer, switches } = sampleGithub;
const [shop, relay, ...others] = folder.blocks;

const board = (extra = {}) => ({ ...folder, stats: statistics, ...extra });
const withFailure = { blocks: [shop, { ...relay, failure: oneFailed }, ...others] };
const rerunnable = (check) => (check.state === 'failed' ? { ...check, verbs: [{ label: 'Re-run' }, { label: 'Full log' }] } : check);
const switchedOff = { ...sampleAreas, Panels: { ...sampleAreas.Panels, pieces: [...sampleAreas.Panels.pieces, ...switches.map((name, index) => ({ name, on: index > 0 }))] } };
const shows = { page: 'pieces', view: 'area', area: 'Panels', hidden: sampleHidden, areas: switchedOff };

const boardViews = {
  'A folder of repositories: one block each': [board(), 'one block per repository the folder holds, the ones that need you first; a count, failing checks or a long wait are said only where there is one.'],
  'Statistics, open': [board({ statsOpen: true }), 'statistics beside the summary, from what kansō already keeps; what was merged stays in Shipped.'],
  'Statistics, switched off': [{ ...folder }, 'the fold is gone and nothing behind it is read.'],
  'Checks and the oldest wait, switched off': [{ ...folder, shown: { checks: false, stale: false } }, 'each switch stops its read; the row keeps its counts and nothing else.'],
  'A repository under the pointer': [board({ hover: 'relay' }), 'Open the list comes with the pointer; the row keeps its height.'],
  'Keyboard on a repository': [board({ focus: 'relay' }), '↑↓ move between repositories, ↵ opens or folds one.'],
  'A repository opened to its pull requests': [board({ open: 'acme-shop' }), 'Needs you, then Yours, in place; ↵ on the repository folds it again.'],
  'A pull request, from the keyboard': [board({ open: 'acme-shop', focus: pullRequest(143) }), '↵ opens it, A approves it without opening it.'],
  'One repository: its block, no fold': [{ ...one }, 'with one repository the block is the panel; the branch in front still leads.'],
  'Outside a repository: all of GitHub': [{ ...everywhere }, 'the same blocks from GitHub itself, so the panel works from any folder.'],
  'Outside a repository, no GitHub access': [{ empty: contexts.noAccess }, 'one quiet line, with the one thing to do.'],
  'Repositories found, not signed in': [{ empty: contexts.signIn }, 'the folder’s repositories are known, GitHub is not: sign in.'],
  'Looking for repositories': [{ looking }, 'the folder is read once; the blocks appear as each repository answers.'],
  'First read': [{ reading: true }, 'the skeleton, once; later reads keep the blocks.'],
  'Nothing waits on you': [{ blocks: noNeeds.blocks }, 'only what you opened is listed; the blocks with nothing of yours say nothing.'],
  'Nothing open anywhere': [{ empty: contexts.nothingOpen }, 'one quiet line.'],
  'The read failed': [{ failure }, 'one failure block, GitHub’s own words, Refresh and Explain.'],
  'One repository could not be read': [board(withFailure), 'its row says so with Refresh; the other blocks stay.'],
  'Rate limited': [board({ scope: stale.limited, stale: true }), 'the last read stays, stepped down, with when GitHub lets it read again.'],
  'GitHub not answering': [board({ scope: stale.silent, stale: true }), 'the last read stays, with the next try.'],
  'A repository with no GitHub remote': [board({ missing: noRemote }), 'it is listed so you know it was seen, dimmed, with nothing to press.'],
  'Another computer': [board({ scope: computer }), 'the computer’s name is the only scope line; its repositories are read there.'],
  'That computer unreachable': [board({ scope: stale.unreachable, stale: true }), 'the last read stays, stepped down.'],
  'Narrow, 300': [board({ look: 'narrow', open: 'acme-shop' }), 'names cut; the counts and the state stay.'],
  'What shows: each part switchable': [{ settingsOf: shows }, 'statistics, checks per repository and the oldest wait each have a switch under Panels; a switch off stops its read.'],
};

const pageViews = {
  'A pull request, opened from its block': [openedPull(verdicts.failed, { acts: ['rerun', 'explain', 'log'], scope: samplePull.branch }), 'GitHub’s verdict, its reason, then Re-run first; Back returns to the block it came from.'],
  'Description, reviewers, checks and files': [detailed({ checks: detailSample.checks.map(rerunnable) }), 'what GitHub shows in one scroll; a failing check carries Re-run and Full log.'],
  'A file’s diff': [pageOf('file', samplePullPages.diff), 'a page of the panel, as today; a line takes a comment where it is.'],
  'Threads, answered where they are': [talked(), 'each thread on its lines with Reply and Resolve; a reply shows at once.'],
  'A failing check’s log, and Re-run': [pageOf('log', samplePullPages.log, { agent: samplePull.agent }), 'the whole log in the panel, Re-run beside Explain.'],
  'Request a review, from the picker': [picker('Request a review', reviewers(['sam', 'stan'])), 'each click is kept at once; Undo is the same click.'],
  'Review, from the keyboard': [openedPull(reviewSample, { review: reviewSample, keys: true }), 'A approves, R requests changes, C comments.'],
  'Merge, from the keyboard': [openedPull(verdicts.ready, { acts: ['squash'], keys: true }), 'M squashes and merges; a second M confirms.'],
  'Re-run, from the keyboard': [openedPull(verdicts.failed, { acts: ['rerun', 'explain', 'log'], keys: true }), 'E re-runs the failed checks.'],
};

const merged = { text: 'Merged', tone: 'done' };
const readied = { ...verdicts.draft, text: '1 check running' };
const reviewing = (after) => (outcome, state) => (state === 'refused' ? openedPull(reviewSample, { review: reviewSample, outcome }) : openedPull({ ...reviewSample, ...after }, { outcome }));
const stages = {
  approve: reviewing({ text: 'Approved by you', tone: 'done' }),
  request: reviewing({ text: 'Changes requested by you', tone: 'blocked' }),
  comment: (outcome) => openedPull(verdicts.failed, { acts: failedActs, talk: { thread: talkSample, said: events.comment }, outcome }),
  rerun: (outcome, state) => (state === 'refused' ? openedPull(verdicts.failed, { acts: ['rerun', 'explain', 'log'], outcome }) : openedPull(verdicts.running, { checking: true, outcome })),
  merge: (outcome, state) => (state === 'done' ? openedPull(merged, { closing: false, outcome }) : openedPull(verdicts.ready, { acts: state === 'refused' ? ['squash'] : [], outcome })),
  close: (outcome, state) => (state === 'refused' ? openedPull(verdicts.ready, { acts: ['squash'], outcome }) : openedPull(verdicts.closed, { closing: false, outcome })),
  ready: (outcome, state) => (state === 'refused' ? openedPull(verdicts.draft, { acts: ['ready'], outcome }) : openedPull(readied, { outcome })),
  reviewers: (outcome) => openedPull(verdicts.review, { acts: ['explain'], outcome }),
};
const outcomes = ['pending', 'done', 'refused'];
const outcomeOf = (action, state) => outcomeLine({ state, said: state === 'pending' ? (action.pending ?? action.said) : action.said, undo: Boolean(action.undo), failure: action.refused });
const wordsOf = (action) => ({
  pending: 'pressed, it shows at once: its line breathes until GitHub answers.',
  done: action.undo ? `confirmed; Undo ${action.undo}.` : 'confirmed; nothing can undo it, so it asked twice.',
  refused: 'refused: GitHub’s words, and the press again.',
});
const labelOf = (action, state) => ({ pending: `${action.name}: pending`, done: action.undo ? `${action.name}: confirmed, Undo after` : `${action.name}: confirmed`, refused: `${action.name}: refused` })[state];
const acts = Object.fromEntries(Object.entries(stages).flatMap(([key, stage]) => outcomes.map((state) => {
  const action = sampleActions[key];
  return [labelOf(action, state), [stage(outcomeOf(action, state), state), wordsOf(action)[state]]];
})));

const mergeAsked = { 'Squash and merge: press again': [openedPull(verdicts.ready, { acts: ['squash'], armed: true }), 'it asks again, as nothing can undo a merge.'] };

const { create, refused: createRefused } = samplePullPages;
const opened = sampleActions.open;
const openActs = {
  'Create pull request: pending': [{ page: 'new', ...create, creating: true }, 'pressed, Create breathes until GitHub answers.'],
  'Create pull request: confirmed, Undo after': [openedPull({ ...verdicts.review, number: pullRequest(149), title: create.title }, { acts: ['explain'], outcome: outcomeOf(opened, 'done') }), `confirmed; Undo ${opened.undo}.`],
  'Create pull request: refused': [{ page: 'new', ...create, failure: { ...createRefused, fix: 'Create' } }, 'refused: GitHub’s words, the text kept.'],
};
const replyActs = {
  'Reply: pending': [talked({ thread: { ...talkSample, answer: answers.answer } }), 'pressed, the reply shows at once, pending.'],
  'Reply: confirmed, Undo after': [openedPull(verdicts.failed, { acts: failedActs, talk: { thread: { ...talkSample, answer: { ...answers.answer, pending: false } } }, outcome: outcomeOf(sampleActions.reply, 'done') }), `confirmed; Undo ${sampleActions.reply.undo}.`],
  'Reply: refused': [talked({ typing: answers.answer.text, refused: refusals.reply }), 'refused: GitHub’s words, the text kept.'],
};

const proposed = (views) => Object.fromEntries(Object.entries(views).map(([label, [props, caption]]) => [label, [props, `Proposed: ${caption}`]]));
export const githubViews = proposed({ ...boardViews, ...pageViews, ...mergeAsked, ...acts, ...openActs, ...replyActs });
