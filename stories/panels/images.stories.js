import stories from './images.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Images" };

export const ImagesTwoNotesReadyToSend = { name: "Images, Two notes, ready to send", ...story(stories.ImagesTwoNotesReadyToSend) };
export const ImagesANewPinItsNoteTypedBesideIt = { name: "Images, A new pin: its note typed beside it", ...story(stories.ImagesANewPinItsNoteTypedBesideIt) };
export const ImagesItsAgentWaitsOnYouSent = { name: "Images, Its agent waits on you · sent", ...story(stories.ImagesItsAgentWaitsOnYouSent) };
export const ImagesAnotherComputerNotBroughtOverYet = { name: "Images, Another computer: not brought over yet", ...story(stories.ImagesAnotherComputerNotBroughtOverYet) };
export const ImagesAnotherComputerUnreachable = { name: "Images, Another computer, unreachable", ...story(stories.ImagesAnotherComputerUnreachable) };
export const ImagesEmpty = { name: "Images, Empty", ...story(stories.ImagesEmpty) };
export const ImagesNoAgentInFocus = { name: "Images, No agent in focus", ...story(stories.ImagesNoAgentInFocus) };
export const ImagesLoadingThePicturePinnedToOneAgent = { name: "Images, Loading the picture · pinned to one agent", ...story(stories.ImagesLoadingThePicturePinnedToOneAgent) };
export const ImagesAReadFailed = { name: "Images, A read failed", ...story(stories.ImagesAReadFailed) };
export const ImagesNarrow300 = { name: "Images, Narrow, 300", ...story(stories.ImagesNarrow300) };
export const ImagesAtRestNow = { name: "Images, At rest, Now", ...story(stories.ImagesAtRestNow) };
export const ImagesAtRestNowLight = { name: "Images, At rest, Now, light", ...story(stories.ImagesAtRestNowLight) };
export const ImagesPointerOnThePicture = { name: "Images, Pointer on the picture", ...story(stories.ImagesPointerOnThePicture) };
