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
export const SimulatorAtRestNow = { name: "Simulator, At rest, Now", ...story(stories.SimulatorAtRestNow) };
export const SimulatorAtRestNowLight = { name: "Simulator, At rest, Now, light", ...story(stories.SimulatorAtRestNowLight) };
export const SimulatorPointerOnTheDevice = { name: "Simulator, Pointer on the device", ...story(stories.SimulatorPointerOnTheDevice) };
