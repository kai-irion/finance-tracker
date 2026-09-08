// Categorical chart palette — 8 hues in the same OKLCH lightness/chroma register as
// the app's gold accent (--color-accent, #b68235), not the accent itself: a mono-accent
// design system has no shipped categorical theme, and a pure gold-only palette can't
// give 8 distinguishable series. Validated with the dataviz skill's validate_palette.js
// against both chart surfaces (--color-bg #f3f2f2, --color-surface #eae9e9): passes
// lightness band, chroma floor, CVD separation, and the normal-vision floor; four slots
// WARN on contrast-vs-surface (sub-3:1), which is why every chart below keeps its
// <Legend> — the documented relief channel for that WARN, not optional here.
//
// Fixed hue order, never cycled or reassigned when a filter changes which series show.
export const CATEGORICAL = [
  "#cc6946", // rust/terracotta
  "#009ac1", // teal-blue
  "#a98400", // ochre
  "#9674ce", // violet
  "#00a29b", // cyan-teal
  "#c37221", // amber (closest literal match to the accent)
  "#be66a3", // plum
  "#6d9938", // moss
];

// Chart ink (axis/grid/label colors) — maps onto the design system's neutral ramp.
export const CHART_INK = {
  primary: "#201f1d", // --color-text
  secondary: "#605d5d", // --color-neutral-700
  muted: "#7d7979", // --color-neutral-600
  grid: "#d7d3d3", // --color-neutral-300
};

// Shared Recharts <Tooltip>/<Legend> style override so they read as part of the
// editorial surface (Lora body, cream card) instead of Recharts' default white/sans-serif
// popup — every chart component should spread this into its Tooltip's contentStyle.
export const CHART_TOOLTIP_STYLE = {
  background: "#eae9e9",
  border: "1px solid color-mix(in srgb, #201f1d 16%, transparent)",
  borderRadius: 4,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  color: "#201f1d",
};
