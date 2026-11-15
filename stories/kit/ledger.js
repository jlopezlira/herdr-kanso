// One fact, one home: no fact is shown twice; why, and simple examples.
export const why = "Never show the same fact twice. A second copy is read again and says nothing new: it is noise, and when the two disagree nobody knows which one is true. Each fact lives in one place, where you would look for it.";
export const exception = "Only while that place is out of view may another stand in for it, in the same words, and it leaves when the place comes back.";
export const grounds = [
  ["Kansō, simplicity", "leave out what is not needed. kansō is named after it; see Philosophy. Yūgen gives the stand-in: show detail only when its home is out of view."],
  ["Aesthetic and minimalist design", "Jakob Nielsen's eighth usability heuristic (1994): every extra unit of information competes with the relevant units and diminishes their relative visibility."],
  ["Don't repeat yourself", "Hunt and Thomas, The Pragmatic Programmer (1999): every piece of knowledge must have a single, unambiguous, authoritative representation. Two copies drift apart."],
];
export const examples = [
  ["A list and a badge counting its rows", "The list"],
  ["A word and a dot that means the same", "The word"],
  ["An error on its row and in a toast while the row is on screen", "The row"],
  ["A branch on the project row and again in the pane header", "The project row"],
];
export const ledgerPrompt = [
  `One fact, one home. ${why} ${exception}`,
  `Grounds: ${grounds.map(([name]) => name).join("; ")}.`,
  `Examples, twice and the one to keep:\n${examples.map(([twice, keep]) => `- ${twice}: keep ${keep.toLowerCase()}.`).join("\n")}`,
].join("\n\n");
