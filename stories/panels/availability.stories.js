import stories from './availability.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Availability" };

export const AvailabilityAMacWithDockerXcodeAndTheGuard = { name: "Availability, A Mac with Docker, Xcode and the guard", ...story(stories.AvailabilityAMacWithDockerXcodeAndTheGuard) };
export const AvailabilityALinuxBoxWithNoneOfThemContainersMemoryAndSimulatorAreNotThere = { name: "Availability, A Linux box with none of them: Containers, Memory and Simulator are not there", ...story(stories.AvailabilityALinuxBoxWithNoneOfThemContainersMemoryAndSimulatorAreNotThere) };
export const AvailabilitySettingsPiecesOnThatBoxTheRowsAreAbsentToo = { name: "Availability, Settings · Pieces on that box: the rows are absent too", ...story(stories.AvailabilitySettingsPiecesOnThatBoxTheRowsAreAbsentToo) };
