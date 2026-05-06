"use client";

import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChartSpec, ResultData } from "@/app/lib/types";
import { buildChartConfig } from "@/app/lib/chart-utils";
import ResultTable from "./ResultTable";

interface ChartPanelProps {
  chartSpec: ChartSpec | null;
  resultData: ResultData | null;
  title?: string;
}

export default function ChartPanel({ chartSpec, resultData, title }: ChartPanelProps) {
  if (!resultData || !resultData.columns.length) {
    return (
      <Card>
        <CardHeader><CardTitle>{title || "No data"}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No results to display</p></CardContent>
      </Card>
    );
  }

  // Fallback to table if no valid chart spec
  if (!chartSpec || !chartSpec.chart_type) {
    return (
      <Card>
        <CardHeader><CardTitle>{title || "Results"}</CardTitle></CardHeader>
        <CardContent><ResultTable data={resultData} /></CardContent>
      </Card>
    );
  }

  const config = buildChartConfig(chartSpec, resultData);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title || config.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          {renderChart(config)}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function renderChart(config: ReturnType<typeof buildChartConfig>) {
  const { type, data, xKey, xLabel, yLabel, series } = config;

  const commonAxisProps = {
    xAxis: <XAxis dataKey={xKey} label={{ value: xLabel, position: "insideBottom", offset: -5 }} />,
    yAxis: <YAxis label={{ value: yLabel, angle: -90, position: "insideLeft" }} />,
    grid: <CartesianGrid strokeDasharray="3 3" />,
    tooltip: <Tooltip />,
    legend: <Legend />,
  };

  switch (type) {
    case "bar":
      return (
        <BarChart data={data}>
          {commonAxisProps.grid}
          {commonAxisProps.xAxis}
          {commonAxisProps.yAxis}
          {commonAxisProps.tooltip}
          {commonAxisProps.legend}
          {series.map((s) => (
            <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name} fill={s.color} />
          ))}
        </BarChart>
      );

    case "line":
      return (
        <LineChart data={data}>
          {commonAxisProps.grid}
          {commonAxisProps.xAxis}
          {commonAxisProps.yAxis}
          {commonAxisProps.tooltip}
          {commonAxisProps.legend}
          {series.map((s) => (
            <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name} stroke={s.color} />
          ))}
        </LineChart>
      );

    case "area":
      return (
        <AreaChart data={data}>
          {commonAxisProps.grid}
          {commonAxisProps.xAxis}
          {commonAxisProps.yAxis}
          {commonAxisProps.tooltip}
          {commonAxisProps.legend}
          {series.map((s) => (
            <Area key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.3} />
          ))}
        </AreaChart>
      );

    case "pie": {
      const COLORS = series.map((s) => s.color);
      return (
        <PieChart>
          {commonAxisProps.tooltip}
          {commonAxisProps.legend}
          <Pie
            data={data}
            dataKey={series[0]?.dataKey || "value"}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={120}
            label
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    case "scatter":
      return (
        <ScatterChart>
          {commonAxisProps.grid}
          {commonAxisProps.xAxis}
          {commonAxisProps.yAxis}
          {commonAxisProps.tooltip}
          {commonAxisProps.legend}
          {series.map((s) => (
            <Scatter key={s.dataKey} name={s.name} data={data} fill={s.color} />
          ))}
        </ScatterChart>
      );

    default:
      return (
        <BarChart data={data}>
          {commonAxisProps.grid}
          {commonAxisProps.xAxis}
          {commonAxisProps.yAxis}
          {commonAxisProps.tooltip}
          {commonAxisProps.legend}
          {series.map((s) => (
            <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name} fill={s.color} />
          ))}
        </BarChart>
      );
  }
}
