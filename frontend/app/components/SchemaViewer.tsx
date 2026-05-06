"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Table2, Columns3 } from "lucide-react";
import type { SchemaCache, SchemaProfile } from "@/app/lib/types";

interface SchemaViewerProps {
  schema: SchemaCache | null;
  profile: SchemaProfile | null;
}

export default function SchemaViewer({ schema, profile }: SchemaViewerProps) {
  if (!schema || !schema.tables.length) {
    return <p className="text-sm text-muted-foreground">No schema loaded. Click &quot;Sync Schema&quot; to introspect.</p>;
  }

  const profileMap = new Map(
    (profile?.tables || []).map((t) => [t.name, t])
  );

  return (
    <div className="space-y-1">
      {schema.tables.map((table) => (
        <TableNode
          key={table.name}
          name={table.name}
          columns={table.columns}
          profileTable={profileMap.get(table.name)}
        />
      ))}
    </div>
  );
}

function TableNode({
  name,
  columns,
  profileTable,
}: {
  name: string;
  columns: { name: string; type: string }[];
  profileTable?: { row_count: number; columns: { name: string; distinct_count?: number; sample_values?: string[] }[] };
}) {
  const [open, setOpen] = useState(false);
  const rowCount = profileTable?.row_count;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-muted text-sm"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Table2 className="h-3.5 w-3.5 text-blue-500" />
        <span className="font-medium">{name}</span>
        {rowCount != null && (
          <span className="text-xs text-muted-foreground ml-auto">{rowCount.toLocaleString()} rows</span>
        )}
      </button>
      {open && (
        <div className="ml-6 space-y-0.5 py-1">
          {columns.map((col) => {
            const profCol = profileTable?.columns.find((c) => c.name === col.name);
            return (
              <div key={col.name} className="flex items-center gap-2 text-xs px-2 py-0.5">
                <Columns3 className="h-3 w-3 text-muted-foreground" />
                <span>{col.name}</span>
                <span className="text-muted-foreground">{col.type}</span>
                {profCol?.distinct_count != null && (
                  <span className="text-muted-foreground ml-auto">{profCol.distinct_count} distinct</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
