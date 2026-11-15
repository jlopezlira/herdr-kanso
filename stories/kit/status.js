// Each page's one status: approved pages are Ready, every other page is In review.
export const STATUSES = ["Ready", "In review", "Proposal", "Old look"];
export const STATUS_PROMPT = {
  Ready: "Follow the approved reference drawings and guidelines below. Additional states are Proposed.",
  "In review": "This design is In review and needs approval.",
  Proposal: "This design is a Proposal and needs approval.",
  "Old look": "This page shows the app's current look; it is not redesigned yet.",
};

const READY = ["Start/Philosophy", "Start/About", "Start/One fact, one home", "Tokens/Colour", "Tokens/Contrast, light and dark", "Tokens/Type", "Tokens/Spacing", "Tokens/Radius", "Tokens/Motion", "Tokens/Icons", "Primitives/Avatar", "Primitives/Button", "Primitives/Card", "Primitives/Chip", "Primitives/Code", "Primitives/Dialog", "Primitives/Drag handle", "Primitives/Field", "Primitives/Key hint", "Primitives/Mark", "Primitives/Markdown", "Primitives/Menu", "Primitives/Metric", "Primitives/Row", "Primitives/Skeleton", "Primitives/Switch", "Primitives/Tab", "Primitives/Thumbnail", "Primitives/Toast", "Primitives/Tooltip"];

export const statusOf = (page) => READY.includes(page) ? "Ready" : "In review";
export const statusTags = (page) => READY.includes(page) ? [] : [statusOf(page)];
