// The project row: a project in the sidebar, the row in its heading configuration.
import { icon, phrase, row } from './kit.js';

// `sync`: a fact or facts after the branch; one with a `label` is a press (↑ opens the PR panel, ↓ pulls).
// `ground`: false where the list draws the current project's ground as a pill that glides; `tree`: a worktree under its checkout, 'tee' or 'end'.
// `pending`: a pull until git answers; `missing`: its folder is gone, Locate finds it; `drop`: where a dragged project lands.
export const projectRow = ({ name, folder = null, branch = null, sync = null, open = false, status = 'blocked', count = 0, hover = false, focus = false, ground = true, tree = null, dimmed = false, pending = false, missing = false, drop = null }) => row({
  icon: tree ? 'lu-git-branch' : 'none', name, heading: true, current: open && ground, hover, focus, dimmed, pending, drop, depth: tree ? 1 : 0, guides: tree ? [tree] : [],
  detail: [folder, branch && { icon: 'lu-git-branch', text: branch }, sync].flat(),
  mark: count ? status : 'none', meta: missing ? 'Not found' : count || null,
  action: missing ? { kind: 'icon', ...icon('lu-folder', 'Locate') } : null,
  actions: [!missing && icon('lu-plus', phrase('New agent in', name)), icon('lu-ellipsis', 'More')].filter(Boolean),
});
