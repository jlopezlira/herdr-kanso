import { band, bars, button, code, device, deviceScreen, excerpt, heatmap, meter, note, picture, pin, sentence, shareCard, stack } from './kit.js';
import { sampleFind, sampleShare, sampleShipped } from './panel-samples.js';
import { sampleScreens, sampleShot } from './samples.js';

const sampleSnippet = { text: 'export function bucket(customer) {\n  const plan = planOf(customer);\n  return { plan, tokens: LIMIT[plan] };', kind: 'source', first: 11, line: 12, comment: 0 };
const [, foundHit] = sampleFind.days[0][1];
const charts = { bars, meter, heatmap };
const { rhythm: shipRhythm } = sampleShipped;

export const piecePages = {
  'Primitives/Picture': {
    args: { image: sampleShot, state: 'shown', action: 'Load 4.2 MB', pins: [] },
    markup: (args) => stack({ variant: 'panel' }, picture(args)),
    states: [
      { label: 'Shown', args: {}, caption: 'Sized to its panel, nothing around it.' },
      { label: 'Pinned', args: { pins: [pin({ n: 1, at: [24, 30] }), pin({ n: 2, region: [52, 48, 30, 22] })] }, caption: 'Its pins over it, at a point or around a region.' },
      { label: 'Loading', args: { state: 'loading' }, caption: 'Its breathing shape until it comes.' },
      { label: 'Held', args: { state: 'held' }, caption: 'Too large to bring on its own: the slot and the one action that brings it.' },
    ],
  },
  'Primitives/Annotation': {
    args: { n: 1, at: [24, 30], region: null, pending: false, writing: null, text: '', typing: false },
    markup: ({ n, at, region, pending, writing, text, typing }) => {
      const mark = pin({ n, at, region, pending });
      return at || region ? stack({ variant: 'panel' }, picture({ image: sampleShot, pins: [mark, writing ? note({ text, at: writing, typing }) : null] })) : mark;
    },
    states: [
      { label: 'Placed', args: {}, caption: 'A numbered pin on the point it names.' },
      { label: 'No note yet', args: { pending: true }, caption: 'Stepped down until it has its words.' },
      { label: 'A region', args: { at: null, region: [36, 42, 30, 22] }, caption: 'The pin rings what it names.' },
      { label: 'Writing a note', args: { pending: true, writing: [28, 34], text: 'Count from the server', typing: true }, caption: 'The note opens beside the pin, the caret after the words.' },
      { label: 'Empty note', args: { pending: true, writing: [28, 34], typing: true }, caption: 'Its placeholder until the first word.' },
      { label: 'Inline', args: { at: null }, caption: 'The pin alone, leading its row in a list of notes.' },
    ],
  },
  'Primitives/Device': {
    args: { screen: 'ios', state: 'on', frozen: false, focus: false, touch: null, rotated: false, narrow: false, pins: [] },
    markup: ({ screen, ...look }) => device(look, deviceScreen(sampleScreens[screen])),
    states: [
      { label: 'On', args: {}, caption: 'The app on its screen, in the device’s frame.' },
      { label: 'Another system', args: { screen: 'android' }, caption: 'The same frame for every system.' },
      { label: 'Focus', args: { focus: true }, caption: 'Touches and keys go to it.' },
      { label: 'A touch', args: { focus: true, touch: [50, 82] }, caption: 'The point being pressed.' },
      { label: 'Frozen', args: { frozen: true, pins: [pin({ n: 1, at: [70, 62] })] }, caption: 'Held still to pin; the pins sit over the screen.' },
      { label: 'Off', args: { state: 'off' }, caption: 'The empty frame and Boot.' },
      { label: 'Booting', args: { state: 'booting' }, caption: 'Its breathing blank.' },
      { label: 'Stalled', args: { state: 'stalled' }, caption: 'The last picture, stepped down.' },
      { label: 'Rotated', args: { rotated: true }, caption: 'On its side.' },
      { label: 'Narrow', args: { narrow: true }, caption: 'In a narrow panel.' },
    ],
  },
  'Primitives/Chart': {
    args: { kind: 'bars', bars: shipRhythm.hours, peak: null, low: [], part: [], labels: [], ticks: shipRhythm.ticks, filled: false, share: 0.62, days: sampleShipped.week.days },
    markup: ({ kind, ...args }) => stack({ variant: 'panel' }, charts[kind](args)),
    states: [
      { label: 'Bars', args: {}, caption: 'One hairline per period, its height the share of the highest; ticks under the run.' },
      { label: 'Peak and low', args: { peak: shipRhythm.peak, low: [11] }, caption: 'The peak in the accent, a low in the blocked tone.' },
      { label: 'Empty periods', args: { bars: shipRhythm.hours.map((value, index) => index % 5 ? value : 0) }, caption: 'A period with nothing keeps its place, in the border colour.' },
      { label: 'A part', args: { part: shipRhythm.hours.map(() => 0.4) }, caption: 'A share stacked inside each bar, in the working tone.' },
      { label: 'Filled', args: { filled: true, peak: shipRhythm.peak }, caption: 'Few bars share the width; the peak in ink.' },
      { label: 'Values', args: { filled: true, bars: [0.4, 0.7, 1, 0.55], labels: ['$12', '$21', '$30', '$16'], ticks: ['Mon', 'Tue', 'Wed', 'Thu'], peak: 2 }, caption: 'Each value over its bar.' },
      { label: 'Meter', args: { kind: 'meter' }, caption: 'A thin track and its filled share.' },
      { label: 'Days', args: { kind: 'heatmap' }, caption: 'Days in week columns, five levels from none to most.' },
    ],
  },
  'Primitives/Excerpt': {
    args: { ...foundHit, where: '', query: sampleFind.query, lead: '', snippet: '', current: false, pending: false, depth: 0 },
    markup: (args) => stack({ variant: 'panel' }, excerpt(args)),
    states: [
      { label: 'Found', args: {}, caption: 'Who and when small on top, the words at body size with the query marked.' },
      { label: 'Current', args: { current: true }, caption: 'The one shown in the conversation, washed.' },
      { label: 'A comment', args: { query: '', where: 'src/api/limits.ts:12' }, caption: 'Its path after who, mono.' },
      { label: 'With its code', args: { query: '', where: 'src/api/limits.ts:12', snippet: code(sampleSnippet) }, caption: 'The lines it talks about between who and the words.' },
      { label: 'Pending', args: { query: '', pending: true }, caption: 'Sent, until GitHub has it.' },
      { label: 'A reply', args: { query: '', depth: 1 }, caption: 'One step in, under what it answers.' },
      { label: 'Opened', args: { query: sampleFind.query, text: sampleFind.turn, lead: button({ label: 'Back', kind: 'icon', icon: 'lu-chevron-left' }) }, caption: 'The whole turn, Back before who.' },
    ],
  },
  'Primitives/Band': {
    args: { text: 'Changed on disk at 14:06', actions: [{ label: 'Overwrite' }, { label: 'Reload', kind: 'quiet' }] },
    markup: (args) => stack({ variant: 'panel' }, band(args)),
    states: [
      { label: 'Changed', args: {}, caption: 'What changed and when, over the document, and the two ways out.' },
      { label: 'Undo', args: { text: 'Overwrote the file at 14:07', actions: [{ label: 'Undo', kind: 'quiet' }] }, caption: 'After the choice, one way back.' },
    ],
  },
  'Primitives/Sentence': {
    args: { text: 'rate-limit-v1, relay-hotfix and one more. Merged branches go too.', tone: 'dim' },
    markup: (args) => stack({ variant: 'panel' }, sentence(args)),
    states: [
      { label: 'Dim', args: {}, caption: 'Words that wrap under what they explain.' },
      { label: 'Muted', args: { tone: 'muted', text: 'Nothing is lost. Merged branches go too.' }, caption: 'A step closer to the ink.' },
      { label: 'Toned', args: { tone: 'blocked', text: 'Loses 2 uncommitted changes in promo-banner. Merged branches go too.' }, caption: 'What an armed act would lose, in the blocked tone.' },
    ],
  },
  'Primitives/Share card': {
    args: { card: 'Ports' },
    markup: ({ card }) => shareCard(sampleShare.cards[card]),
    states: [
      { label: 'A figure and its run', args: {}, caption: 'The heading and its period, the figure and what it means, four counts, a note, then one chart.' },
      { label: 'Six counts', args: { card: 'Memory' }, caption: 'Up to six counts on one line.' },
      { label: 'A change', args: { card: 'Spend' }, caption: 'The change on last period under the figure.' },
      { label: 'A subtitle', args: { card: 'Dōjō' }, caption: 'What it is, under the heading; a streak and a list.' },
      { label: 'Every block', args: { card: 'Shipped' }, caption: 'A smaller figure beside the big one; the streak, the records and the hours.' },
    ],
  },
};
