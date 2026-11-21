export const shippedKeymap = (platform) => `kanso/keys${platform === "windows" ? ".windows" : ""}.json`;
// A tag from before keys.windows.json still merges: the baseline is empty, not missing.
export const missingKeys = (platform) => platform === "windows" ? "{}" : null;
