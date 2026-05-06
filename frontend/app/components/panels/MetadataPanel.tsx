"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Save, Loader2 } from "lucide-react";
import { apiGet, apiPut } from "@/app/lib/api";
import type {
  ConnectionListItem,
  ConnectionDetail,
  MetadataResponse,
  MetadataUpdate,
  TableMetadataItem,
  ColumnMetadataItem,
} from "@/app/lib/types";

export default function MetadataPanel() {
  const [connections, setConnections] = useState<ConnectionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [schema, setSchema] = useState<ConnectionDetail | null>(null);
  const [metadata, setMetadata] = useState<TableMetadataItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ConnectionListItem[]>("/api/v1/connections").then(setConnections).catch(() => {});
  }, []);

  const handleSelectConnection = async (id: number) => {
    setSelectedId(id);
    setMessage(null);
    try {
      const [detail, meta] = await Promise.all([
        apiGet<ConnectionDetail>(`/api/v1/connections/${id}`),
        apiGet<MetadataResponse>(`/api/v1/connections/${id}/metadata`),
      ]);
      setSchema(detail);

      // Merge schema tables with existing metadata
      const tables = detail.schema_cache?.tables || [];
      const metaMap = new Map(meta.tables.map((t) => [t.table_name, t]));

      const merged: TableMetadataItem[] = tables.map((t) => {
        const existing = metaMap.get(t.name);
        return {
          table_name: t.name,
          description: existing?.description || "",
          columns: t.columns.map((c) => {
            const existCol = existing?.columns.find((ec) => ec.column_name === c.name);
            return {
              column_name: c.name,
              description: existCol?.description || "",
            };
          }),
        };
      });
      setMetadata(merged);
    } catch {
      // ignore
    }
  };

  const updateTableDesc = (tableName: string, description: string) => {
    setMetadata((prev) =>
      prev.map((t) => (t.table_name === tableName ? { ...t, description } : t))
    );
  };

  const updateColumnDesc = (tableName: string, colName: string, description: string) => {
    setMetadata((prev) =>
      prev.map((t) =>
        t.table_name === tableName
          ? {
              ...t,
              columns: t.columns.map((c) =>
                c.column_name === colName ? { ...c, description } : c
              ),
            }
          : t
      )
    );
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await apiPut(`/api/v1/connections/${selectedId}/metadata`, {
        tables: metadata,
      } satisfies MetadataUpdate);
      setMessage("Metadata saved");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Table & Column Metadata</h2>
        <Button onClick={handleSave} disabled={saving || !selectedId} size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Add descriptions to help the AI understand your data better. This is optional but improves query accuracy.
      </p>

      {/* Connection selector */}
      <select
        value={selectedId || ""}
        onChange={(e) => e.target.value && handleSelectConnection(Number(e.target.value))}
        className="border rounded-md px-3 py-2 text-sm bg-background w-full max-w-xs"
      >
        <option value="">Select a connection...</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.source_type})
          </option>
        ))}
      </select>

      {message && <div className="p-2 bg-muted rounded text-sm">{message}</div>}

      {/* Metadata editor */}
      {metadata.length > 0 && (
        <div className="space-y-4">
          {metadata.map((table) => (
            <Card key={table.table_name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono">{table.table_name}</CardTitle>
                <Input
                  placeholder="Table description (e.g. 'Customer purchase orders')"
                  value={table.description}
                  onChange={(e) => updateTableDesc(table.table_name, e.target.value)}
                  className="mt-1"
                />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {table.columns.map((col) => (
                    <div key={col.column_name} className="flex items-center gap-3">
                      <span className="text-xs font-mono w-40 shrink-0">{col.column_name}</span>
                      <Input
                        placeholder="Column description"
                        value={col.description}
                        onChange={(e) =>
                          updateColumnDesc(table.table_name, col.column_name, e.target.value)
                        }
                        className="text-sm"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedId && metadata.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No schema found. Please sync the schema in the Connections page first.
        </p>
      )}
    </div>
  );
}
