import stories from './containers.json';
import { story } from './story.js';

export default { title: "Coverage/Containers", id: "coverage-containers" };

export const ContainerList = { name: "Container list", ...story(stories.ContainerList) };
export const ContainerRow = { name: "Container row", ...story(stories.ContainerRow) };
export const ComposeProject = { name: "Compose project", ...story(stories.ComposeProject) };
export const ContainerDisk = { name: "Container disk", ...story(stories.ContainerDisk) };
