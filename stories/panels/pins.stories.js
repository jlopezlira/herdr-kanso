import stories from './pins.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Pins" };

export const PinsIOSPinningARegionANoteBeingTyped = { name: "Pins, iOS, pinning: a region, a note being typed", ...story(stories.PinsIOSPinningARegionANoteBeingTyped) };
export const PinsAndroidPinningTouchesWait = { name: "Pins, Android, pinning: touches wait", ...story(stories.PinsAndroidPinningTouchesWait) };
export const PinsSentLiveAgain = { name: "Pins, Sent: live again", ...story(stories.PinsSentLiveAgain) };
export const PinsNoAgentInFrontThePicker = { name: "Pins, No agent in front: the picker", ...story(stories.PinsNoAgentInFrontThePicker) };
export const PinsKeptFromBeforeNotSent = { name: "Pins, Kept from before, not sent", ...story(stories.PinsKeptFromBeforeNotSent) };
export const PinsImagesTheSamePinsNoTool = { name: "Pins, Images: the same pins, no tool", ...story(stories.PinsImagesTheSamePinsNoTool) };
export const PinsRotatedSinceTheFreeze = { name: "Pins, Rotated since the freeze", ...story(stories.PinsRotatedSinceTheFreeze) };
export const PinsThePictureHadStalled = { name: "Pins, The picture had stalled", ...story(stories.PinsThePictureHadStalled) };
export const PinsTheAgentIsOnDevbox = { name: "Pins, The agent is on devbox", ...story(stories.PinsTheAgentIsOnDevbox) };
export const PinsSendRefused = { name: "Pins, Send refused", ...story(stories.PinsSendRefused) };
export const PinsCopyToDevboxRefused = { name: "Pins, Copy to devbox refused", ...story(stories.PinsCopyToDevboxRefused) };
