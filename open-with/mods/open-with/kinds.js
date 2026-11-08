// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte in kanso-panel/ and open-with/ (`npm run sync:share`): edit kanso-panel/kinds.js.
// What a file is by its name: the preview panel shows text, Look shows the rest.

// Markdown rendered, the others as read-only text.
const TEXT = ["md", "markdown", "mdx", "txt", "text", "log", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv", "rst", "adoc", "org", "ini", "cfg", "conf", "env",
  "sh", "zsh", "bash", "fish", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "lua", "sql",
  "html", "css", "scss", "xml", "svg"];

// In Look: a picture as it is, one converted to PNG first, a document's first page, and what only plays outside.
// HTML is left to the browser, where it runs.
export const KINDS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
  convert: ["heic", "heif", "tif", "tiff"],
  pdf: ["pdf"],
  media: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"],
  text: TEXT.filter((e) => e !== "html" && e !== "svg"),
};

const extOf = (path) => (/\.([^./\\]+)$/.exec(String(path)) ?? [])[1]?.toLowerCase() ?? "";

export const isText = (path) => TEXT.includes(extOf(path));

// "image", "convert", "pdf", "media", "text", or null for a file Look leaves alone.
export const kindOf = (path) => Object.keys(KINDS).find((k) => KINDS[k].includes(extOf(path))) ?? null;
