import stories from './status.json';
import { story } from './story.js';

export default { title: "Coverage/Status", id: "coverage-status" };

export const StatusStandIn = { name: "Status stand-in", ...story(stories.StatusStandIn) };
