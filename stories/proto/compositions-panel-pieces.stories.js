import stories from './compositions-panel-pieces.json';
import { story } from './story.js';

export default { title: "Compositions/Panel pieces" };

export const HeaderAndScope = { name: "Header and scope", ...story(stories.HeaderAndScope) };
export const SectionAndRows = { name: "Section and rows", ...story(stories.SectionAndRows) };
export const Card = { name: "Card", ...story(stories.Card) };
export const SettingRow = { name: "Setting row", ...story(stories.SettingRow) };
export const Loading = { name: "Loading", ...story(stories.Loading) };
export const Metric = { name: "Metric", ...story(stories.Metric) };
export const HeroAndVerdict = { name: "Hero and verdict", ...story(stories.HeroAndVerdict) };
export const PlanAndSpend = { name: "Plan and spend", ...story(stories.PlanAndSpend) };
export const MemoryMetricAndChart = { name: "Memory metric and chart", ...story(stories.MemoryMetricAndChart) };
export const PortRow = { name: "Port row", ...story(stories.PortRow) };
export const RowActions = { name: "Row actions", ...story(stories.RowActions) };
export const SettingRowWithAValue = { name: "Setting row with a value", ...story(stories.SettingRowWithAValue) };
export const InATab = { name: "In a tab", ...story(stories.InATab) };
export const ThumbnailStrip = { name: "Thumbnail strip", ...story(stories.ThumbnailStrip) };
