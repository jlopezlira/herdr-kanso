import stories from './containers.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Containers" };

export const ContainersRestOneExitedTwoRunningOneProjectNotStarted = { name: "Containers, Rest: one exited, two running, one project not started", ...story(stories.ContainersRestOneExitedTwoRunningOneProjectNotStarted) };
export const ContainersRunningSelectedDetailsOpen = { name: "Containers, Running, selected, Details open", ...story(stories.ContainersRunningSelectedDetailsOpen) };
export const ContainersDownAndQuitArmedARemovalRefusedOnItsRowNotInAProject = { name: "Containers, Down and Quit armed · a removal refused, on its row · not in a project", ...story(stories.ContainersDownAndQuitArmedARemovalRefusedOnItsRowNotInAProject) };
export const ContainersDockerNotRunning = { name: "Containers, Docker not running", ...story(stories.ContainersDockerNotRunning) };
export const ContainersStartingDocker = { name: "Containers, Starting Docker", ...story(stories.ContainersStartingDocker) };
export const ContainersEmptyWithAStackAProjectCanBringUp = { name: "Containers, Empty, with a stack a project can bring up", ...story(stories.ContainersEmptyWithAStackAProjectCanBringUp) };
export const ContainersDiskOpenPullAnImagesRunFormVolumesBuildCache = { name: "Containers, Disk open: pull, an image's Run form, volumes, build cache", ...story(stories.ContainersDiskOpenPullAnImagesRunFormVolumesBuildCache) };
export const ContainersDockerOnAnotherMachineAContext = { name: "Containers, Docker on another machine (a context)", ...story(stories.ContainersDockerOnAnotherMachineAContext) };
export const ContainersAnotherComputerUnreachable = { name: "Containers, Another computer · unreachable", ...story(stories.ContainersAnotherComputerUnreachable) };
export const ContainersFirstRead = { name: "Containers, First read", ...story(stories.ContainersFirstRead) };
export const ContainersAReadFailed = { name: "Containers, A read failed", ...story(stories.ContainersAReadFailed) };
export const ContainersNarrow300ActionsWrapImageHides = { name: "Containers, Narrow, 300: actions wrap, image hides", ...story(stories.ContainersNarrow300ActionsWrapImageHides) };
export const ContainersAtRestNow = { name: "Containers, At rest, Now", ...story(stories.ContainersAtRestNow) };
export const ContainersAtRestNowLight = { name: "Containers, At rest, Now, light", ...story(stories.ContainersAtRestNowLight) };
export const ContainersPointerOnAcmeShop = { name: "Containers, Pointer on acme-shop", ...story(stories.ContainersPointerOnAcmeShop) };
