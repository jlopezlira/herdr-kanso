// The section heading: a group in Status and Threads, the row in its heading configuration.
import { row } from './kit.js';

// `add`: what + starts there, shown under the pointer (a project's conversations); `focus`: the keyboard is on it.
export const section = ({ title, status = 'none', count = 0, add = null, hover = false, focus = false }) => row({
  name: title, heading: true, mark: status, meta: count || null, hover, focus,
  actions: add ? [{ icon: 'lu-plus', label: add }] : [],
});
