// A mod's source as one script, for the tests and the benchmarks, which run
// a mod in a bare `vm` context with the host (herdr, gpui-kit, gpui-base)
// given as globals. Herdr itself loads the files as ES modules.
//
// An import from the mod's own folder (`./x.js`) is inlined in its own
// scope, so two files may declare the same names:
//   import { a, b } from "./x.js";
// becomes
//   const { a, b } = __pick((() => { <x.js with its exports stripped>; return { ...its exports }; })(), ["a", "b"]);
// where a name the host also provides (a test's stand-in) wins over the
// file's own. Imports from "herdr" and the SDK are dropped (the host provides
// them), and the outer file's own `export` keywords are stripped.
const IMPORT = /^import\s+(?:(\{[^}]*\})\s+from\s+)?["']([^"']+)["'];\r?\n/gm;
const EXPORT_FROM = /^export\s+\{([^}]*)\}\s+from\s+["'](\.\/[^"']+)["'];?[ \t]*\n/gm;
const EXPORTED = /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s+\{([^}]*)\};?/gm;
const PRELUDE = "const __pick = (mod, names) => Object.fromEntries(names.map((n) => [n, typeof globalThis[n] !== \"undefined\" ? globalThis[n] : mod[n]]));\n";

const stripExports = (text) => text.replace(/^export default /gm, "").replace(/^export /gm, "");

// The names a module exports (its default left out).
export function exportedNames(text) {
  const names = [...text.matchAll(EXPORTED)].map((m) => m[1]);
  for (const m of text.matchAll(EXPORT_LIST)) names.push(...m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  return [...new Set(names)];
}

// `read(name)` gives the source of a sibling file by its import name ("./x.js").
export function inlineImports(text, read, seen = new Set()) {
  const lifted = text.replace(/\r\n?/g, "\n").replace(EXPORT_FROM, (_m, spec, from) => `import { ${spec.split(",").map((part) => part.trim()).filter(Boolean).join(", ")} } from "${from}";\n`);
  return lifted.replace(IMPORT, (_m, names, from) => {
    if (!from.startsWith("./")) return "";
    if (seen.has(from)) throw new Error(`${from} imports itself by way of another file`);
    const source = read(from);
    const body = stripExports(inlineImports(source, read, new Set([...seen, from])));
    const module = `(() => {\n${body}\nreturn { ${exportedNames(source).join(", ")} };\n})()`;
    const imported = names ? names.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (!imported.length) return `${module};\n`;
    return `const { ${imported.join(", ")} } = __pick(${module}, ${JSON.stringify(imported)});\n`;
  });
}

// The whole script: imports inlined, exports stripped.
export const modScript = (text, read) => PRELUDE + stripExports(inlineImports(text, read));
