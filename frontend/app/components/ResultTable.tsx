"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { ResultData } from "@/app/lib/types";

interface ResultTableProps {
  data: ResultData;
  maxHeight?: string;
}

export default function ResultTable({ data, maxHeight = "320px" }: ResultTableProps) {
  const { columns, rows } = data;

  if (!columns.length || !rows.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No data</p>;
  }

  return (
    <ScrollArea className="rounded-lg border" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              {columns.map((col, j) => {
                const val = Array.isArray(row) ? row[j] : (row as Record<string, unknown>)[col];
                return (
                  <td key={j} className="px-4 py-2 whitespace-nowrap text-sm">
                    {val == null ? (
                      <span className="text-muted-foreground/40 italic">null</span>
                    ) : typeof val === "number" ? (
                      <span className="font-mono text-xs">{val.toLocaleString()}</span>
                    ) : (
                      String(val)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
