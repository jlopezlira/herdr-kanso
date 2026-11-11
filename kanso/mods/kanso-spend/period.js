// The period Spend shows, remembered for the next time the panel opens.
export const PERIOD_KEY = "kanso.spend.period";

export const SPEND_PERIODS = [
  { key: "day", label: "Today" },
  { key: "month", label: "Month" },
  { key: "30d", label: "30 days" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
];

export const spendPeriod = (saved) => (SPEND_PERIODS.some((period) => period.key === saved) ? saved : "day");
