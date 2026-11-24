import { layout } from "herdr";
import { walkLayout, commitLayout, isKansoTree } from "./layout.js";

export const hasPanel = () => isKansoTree(layout()) && Boolean(walkLayout(layout(), "panel-body"));
export const previewProps = (file, machine) => ({ panel: "preview", path: file, on: machine });

export function showPreview(file, machine) {
  if (!hasPanel()) return false;
  const child = { id: "preview", type: "block", content: { mod: "kanso-panel", props: previewProps(file, machine) } };
  return commitLayout({ panel: child });
}
