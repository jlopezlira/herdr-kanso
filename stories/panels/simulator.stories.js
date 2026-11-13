import stories from './simulator.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Simulator" };

export const SimulatorIOSThePicture = { name: "Simulator, iOS: the picture", ...story(stories.SimulatorIOSThePicture) };
export const SimulatorAndroidTouchKeysTheDevicesButtons = { name: "Simulator, Android: touch, keys, the device's buttons", ...story(stories.SimulatorAndroidTouchKeysTheDevicesButtons) };
export const SimulatorDevicesTheListReplacesTheScreen = { name: "Simulator, Devices: the list replaces the screen", ...story(stories.SimulatorDevicesTheListReplacesTheScreen) };
export const SimulatorOff = { name: "Simulator, Off", ...story(stories.SimulatorOff) };
export const SimulatorBooting = { name: "Simulator, Booting", ...story(stories.SimulatorBooting) };
export const SimulatorThePictureStalled = { name: "Simulator, The picture stalled", ...story(stories.SimulatorThePictureStalled) };
export const SimulatorError = { name: "Simulator, Error", ...story(stories.SimulatorError) };
export const SimulatorFirstRead = { name: "Simulator, First read", ...story(stories.SimulatorFirstRead) };
export const SimulatorNarrow300TheDeviceScales = { name: "Simulator, Narrow, 300: the device scales", ...story(stories.SimulatorNarrow300TheDeviceScales) };
export const SimulatorNotesOnTheScreenTakesPointsNotTouches = { name: "Simulator, Notes on: the screen takes points, not touches", ...story(stories.SimulatorNotesOnTheScreenTakesPointsNotTouches) };
export const SimulatorPlacingTheNoteIsWrittenWhereThePointIs = { name: "Simulator, Placing: the note is written where the point is", ...story(stories.SimulatorPlacingTheNoteIsWrittenWhereThePointIs) };
export const SimulatorThreeNotesOneHoveredOneChosenSendNamesTheAgentInFront = { name: "Simulator, Three notes: one hovered, one chosen; Send names the agent in front", ...story(stories.SimulatorThreeNotesOneHoveredOneChosenSendNamesTheAgentInFront) };
export const SimulatorSendingTheRowsWaitNothingElseMoves = { name: "Simulator, Sending: the rows wait, nothing else moves", ...story(stories.SimulatorSendingTheRowsWaitNothingElseMoves) };
export const SimulatorSentThePointsClearOneLineSaysWhereTheyWent = { name: "Simulator, Sent: the points clear, one line says where they went", ...story(stories.SimulatorSentThePointsClearOneLineSaysWhereTheyWent) };
export const SimulatorANoteRemovedOnePressUndoInTheToast = { name: "Simulator, A note deleted: one press, Undo in the toast", ...story(stories.SimulatorANoteRemovedOnePressUndoInTheToast) };
export const SimulatorNoAgentInFrontSendWaitsForOne = { name: "Simulator, No agent in front: Send waits for one", ...story(stories.SimulatorNoAgentInFrontSendWaitsForOne) };
export const SimulatorCouldNotSendTheNotesStay = { name: "Simulator, Could not send: the notes stay", ...story(stories.SimulatorCouldNotSendTheNotesStay) };
export const SimulatorLightThreeNotes = { name: "Simulator, Light: three notes", ...story(stories.SimulatorLightThreeNotes) };
export const SimulatorLightPlacing = { name: "Simulator, Light: placing", ...story(stories.SimulatorLightPlacing) };
export const SimulatorAtRestNow = { name: "Simulator, At rest, Now", ...story(stories.SimulatorAtRestNow) };
export const SimulatorAtRestNowLight = { name: "Simulator, At rest, Now, light", ...story(stories.SimulatorAtRestNowLight) };
export const SimulatorPointerOnTheDevice = { name: "Simulator, Pointer on the device", ...story(stories.SimulatorPointerOnTheDevice) };
