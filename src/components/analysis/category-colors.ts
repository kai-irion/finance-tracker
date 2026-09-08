// Donut chart category colors — single source of truth transcribed from
// financehub_analysis_redesign.html (SVG <circle> strokes + legend .dot
// backgrounds). Both the SVG segments and the legend resolve their color from
// this array by category name, so colors and labels can never fall out of sync.
// To add/rename a category, edit ONLY this array.
export const CATEGORY_COLORS = [
  { name: "Groceries", color: "#1F6F54" },
  { name: "Rent", color: "#C98A3F" },
  { name: "Transport", color: "#5B7A8C" },
  { name: "Dining out", color: "#A85C4A" },
  { name: "Other", color: "#D8D4C8" },
] as const;

export type CategoryName = (typeof CATEGORY_COLORS)[number]["name"];

// Track (background ring) color — the redesign's --border token.
export const DONUT_TRACK_COLOR = "#E6E4DE";

const colorByName = new Map<string, string>(
  CATEGORY_COLORS.map((c) => [c.name, c.color])
);

export function categoryColor(name: string): string {
  return colorByName.get(name) ?? DONUT_TRACK_COLOR;
}
