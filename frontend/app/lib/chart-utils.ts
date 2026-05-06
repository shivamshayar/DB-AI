import type { ChartSpec, ResultData } from "./types";

const DEFAULT_COLORS = [
  "#6366f1", "#06b6d4", "#f59e0b", "#ec4899",
  "#10b981", "#8b5cf6", "#f43f5e", "#84cc16",
];

export interface ChartConfig {
  type: "bar" | "line" | "area" | "pie" | "scatter";
  title: string;
  xKey: string;
  xLabel: string;
  yLabel: string;
  series: { dataKey: string; name: string; color: string }[];
  data: Record<string, unknown>[];
}

/**
 * Transform LLM chart spec + query result data into a format
 * ready for Recharts components.
 */
export function buildChartConfig(
  spec: ChartSpec,
  resultData: ResultData
): ChartConfig {
  const { columns, rows } = resultData;

  // Convert rows (arrays) into objects keyed by column name
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const val = Array.isArray(row) ? row[i] : (row as Record<string, unknown>)[col];
      // Try to parse numeric strings
      if (typeof val === "string" && !isNaN(Number(val)) && val.trim() !== "") {
        obj[col] = Number(val);
      } else {
        obj[col] = val;
      }
    });
    return obj;
  });

  const series = spec.series.map((s, i) => ({
    dataKey: s.field,
    name: s.label,
    color: s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }));

  return {
    type: spec.chart_type,
    title: spec.title,
    xKey: spec.x_axis.field,
    xLabel: spec.x_axis.label,
    yLabel: spec.y_axis.label,
    series,
    data,
  };
}
