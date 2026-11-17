// A folder's short word: its tilde form.
import { paths } from "./platform-paths.js";
import { home } from "herdr";

export const shortFolder = (cwd) => (cwd ? paths.shorten(cwd, home()) : "");
