const SUFFIX = { macos: "", windows: ".windows" };
export const shippedKeymap = (platform) => `kanso/keys${SUFFIX[platform] ?? ".linux"}.json`;
// A tag from before keys.windows.json still merges: the baseline is empty, not missing.
export const missingKeys = (platform) => platform === "windows" ? "{}" : null;
export const formerKeymap = (platform) => platform in SUFFIX ? null : "kanso/keys.json";
