// The sidebar's Header: the window's lights, then the Toolbar, drawn; in Dawn Mode the sky behind them and, open, the pill that names the installed version.
import { chip, dawn, stack } from './kit.js';

// Stable Mode shows nothing; the sky can be turned off, the pill cannot. Collapsed, the rail is too narrow for the pill.
// Proposed: `title: false` leaves the lights' row out, where the window draws it in a block of its own above (the app's sidebar).
export const header = ({ collapsed = false, dawn: early = false, version = null, art = true, title = true, toolbar = null } = {}) => stack({ variant: 'header', collapsed },
  title && early && art ? dawn() : null,
  title ? stack({ variant: 'header title' }, early && !collapsed && version ? chip({ label: version, pill: true }) : null) : null,
  toolbar);
