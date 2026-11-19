import { pullRequest } from './samples.js';
import { samplePull, samplePulls } from './panel-samples.js';

const pull = (number, title, state, extra = {}) => ({ number: pullRequest(number), title, state, ...extra });
const repository = (name, { needs = [], yours = [], checks = null, stale = null, ...extra }) => ({ name, needs, yours, checks, stale, ...extra });
const failing = (count) => ({ text: `${count} failing`, tone: 'blocked' });

const shop = repository('acme-shop', {
  needs: [pull(143, 'Show the retry time in the cart', 'failed'), pull(146, 'Round Retry-After up to whole seconds', 'review')],
  yours: [pull(142, 'Rate limit checkout per customer', 'failed'), pull(140, 'Move the limits to Redis', 'blocked'), pull(148, 'Cache the plan lookup', 'approved')],
  checks: failing(2),
});
const relay = repository('relay', { needs: [pull(44, 'Batch webhook retries', 'review')], yours: [pull(42, 'Make webhook delivery safe to retry', 'changes')] });
const billing = repository('billing', { needs: [pull(91, 'Round tax per line, not per order', 'failing')], checks: failing(1) });
const docs = repository('docs-site', { yours: [pull(145, 'Translate the limits page', 'draft')], stale: 'oldest 21d' });
const noRemote = { name: 'infra', second: 'No GitHub remote' };

const everywhere = [
  shop,
  relay,
  repository('jlopezlira/dotfiles', { yours: [pull(12, 'Move the shell setup to one file', 'review')] }),
  repository('herdr-app', { needs: [pull(575, 'Recycle the mod runtime before it runs out of memory', 'approved')] }),
];

export const sampleGithub = {
  folder: { blocks: [shop, relay, billing, docs] },
  noNeeds: { blocks: [{ ...shop, needs: [], checks: null }, { ...relay, needs: [] }, docs] },
  one: { block: { ...shop, branch: samplePulls.branches.none } },
  everywhere: { blocks: everywhere, scope: 'Not in a repository' },
  noRemote,
  statistics: {
    summary: '5d oldest · 2 new',
    oldest: ['Waiting longest', `${pullRequest(44)} relay · 5d`],
    review: ['To review', '+4,310 −980 in 4 pull requests'],
    fresh: ['New since you looked', '2'],
    waited: 'How long they have waited, by day',
    ages: { bars: [0.4, 1, 0.55, 0.3, 0.15, 0.05], ticks: ['today', '3 weeks'], peak: 1 },
    shipped: 'Merged this week is in Shipped',
  },
  contexts: {
    nothingWaits: { icon: 'lu-git-pull-request', text: 'Nothing waits on you' },
    nothingOpen: { icon: 'lu-git-pull-request', text: 'Nothing open in these repositories' },
    noAccess: { icon: 'lu-git-pull-request', text: 'No repository here, and not signed in to GitHub', action: 'Sign in' },
    signIn: samplePulls.contexts.signIn,
  },
  looking: 'Looking for repositories in this folder',
  failure: { text: 'Can’t read pull requests', source: 'gh: HTTP 401: Bad credentials', fix: 'Refresh', agent: 'checkout' },
  oneFailed: { text: 'Couldn’t read relay', fix: 'Refresh', detail: 'gh: HTTP 502: Bad Gateway' },
  stale: { limited: 'Read 14:02 · GitHub limited until 14:30', silent: 'Read 14:02 · GitHub not answering · next try 14:07', unreachable: 'Read 14:02 · devbox unreachable · next try 14:07' },
  computer: samplePull.remote.computer,
  switches: ['PR statistics', 'PR checks per repository', 'PR oldest waiting'],
};

const refusal = (text, source, fix) => ({ text, source, fix });

export const sampleActions = {
  approve: { name: 'Approve', said: `You approved ${pullRequest(44)}`, undo: 'dismisses the review', refused: refusal('Couldn’t approve', 'gh: HTTP 504: Gateway Timeout', 'Approve') },
  request: { name: 'Request changes', said: `You asked for changes on ${pullRequest(44)}`, undo: 'dismisses the review', refused: refusal('Couldn’t request changes', 'gh: HTTP 422: Review body is too long', 'Request changes') },
  comment: { name: 'Comment', said: 'You commented', undo: 'deletes the comment', refused: refusal('Comment not posted', 'gh: HTTP 502: Bad Gateway', 'Comment') },
  rerun: { name: 'Re-run', said: 'test / unit is running again', pending: 'Re-running test / unit', undo: 'cancels the run', refused: refusal('Couldn’t re-run test / unit', 'gh: HTTP 403: Resource not accessible by integration', 'Re-run') },
  merge: { name: 'Squash and merge', said: `Squashed into main · ${pullRequest(142)} merged`, pending: 'Merging', undo: null, refused: samplePull.refusals.merge },
  close: { name: 'Close', said: `${pullRequest(142)} closed`, pending: 'Closing', undo: 'reopens it', refused: refusal('Couldn’t close', 'gh: HTTP 502: Bad Gateway', 'Close') },
  ready: { name: 'Ready for review', said: `${pullRequest(145)} is ready for review`, undo: 'puts it back to draft', refused: refusal('Couldn’t mark it ready', 'gh: HTTP 422: Pull request is not a draft', 'Ready for review') },
  open: { name: 'Create pull request', said: `Opened ${pullRequest(149)}`, pending: 'Opening', undo: 'closes it', refused: refusal('Could not create it', 'gh: GraphQL: No commits between main and rate-limit', 'Create') },
  reply: { name: 'Reply', said: 'You replied to lee', undo: 'deletes the reply', refused: samplePull.refusals.reply },
  reviewers: { name: 'Request a review', said: 'Asked sam and stan to review', pending: 'Asking sam and stan', undo: 'withdraws the request', refused: samplePull.refusals.reviewer },
};
