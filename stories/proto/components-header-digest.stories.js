import stories from './components-header-digest.json';
import { story } from './story.js';

export default { title: "Components/Header digest" };

export const HeaderDigest = { name: "Header digest", ...story(stories.HeaderDigest) };
