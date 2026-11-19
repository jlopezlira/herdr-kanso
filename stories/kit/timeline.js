import { card, diffText, list, markdown, row } from './kit.js';

export const promptEntry = ({ text, at, facts = [], reply, live = false, focus = false }) => card({
  content: row({ name: text, meta: at, second: facts, mark: live ? 'working' : 'none', focus }), body: reply,
});

export const promptOpened = ({ asked, at, also = [], reply, files = [] }) => list(
  card({ author: 'You', initial: null, age: at, body: asked }),
  also.map((message) => card({ author: 'You, while it worked', initial: null, age: message.at, body: message.text })),
  markdown({ source: reply }),
  files.map(({ path, add, del }) => row({ icon: 'lu-file', name: path, meta: diffText({ add, del }) })),
);
