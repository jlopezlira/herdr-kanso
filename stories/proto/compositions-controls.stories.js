import stories from './compositions-controls.json';
import { story } from './story.js';

export default { title: "Compositions/Controls" };

export const KeyHint = { name: "Key hint", ...story(stories.KeyHint) };
export const PillAndAvatar = { name: "Pill and avatar", ...story(stories.PillAndAvatar) };
export const Switch = { name: "Switch", ...story(stories.Switch) };
export const Segmented = { name: "Segmented", ...story(stories.Segmented) };
export const Field = { name: "Field", ...story(stories.Field) };
export const ButtonsFourKinds = { name: "Buttons, four kinds", ...story(stories.ButtonsFourKinds) };
export const ButtonWithAMark = { name: "Button with a mark", ...story(stories.ButtonWithAMark) };
export const Armed = { name: "Armed", ...story(stories.Armed) };
export const FocusRing = { name: "Focus ring", ...story(stories.FocusRing) };
export const HoverSelectedPressed = { name: "Hover, selected, pressed", ...story(stories.HoverSelectedPressed) };
export const Tooltip = { name: "Tooltip", ...story(stories.Tooltip) };
export const ChromeAndBarButtons = { name: "Chrome and bar buttons", ...story(stories.ChromeAndBarButtons) };
