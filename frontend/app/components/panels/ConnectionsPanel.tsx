"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Plus, RefreshCw, Trash2, CheckCircle, Loader2,
  Database, Wifi, WifiOff, Eye, EyeOff, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Pencil, Save, X,
} from "lucide-react";
import SchemaViewer from "@/app/components/SchemaViewer";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/app/lib/api";
import type { ConnectionListItem, ConnectionDetail, ConnectionCreate } from "@/app/lib/types";

const DB_CONFIGS = {
  postgresql: { label: "PostgreSQL", color: "bg-blue-600", defaultPort: 5432, icon: "🐘" },
  mysql: { label: "MySQL", color: "bg-orange-500", defaultPort: 3306, icon: "🐬" },
  sqlite: { label: "SQLite", color: "bg-emerald-500", defaultPort: null, icon: "📁" },
  mssql: { label: "SQL Server", color: "bg-red-600", defaultPort: 1433, icon: "🏢" },
  oracle: { label: "Oracle", color: "bg-amber-600", defaultPort: 1521, icon: "🔴" },
} as const;

type DbType = keyof typeof DB_CONFIGS;

const SSL_OPTIONS = ["disable", "require", "verify-ca", "verify-full"];

export default function ConnectionsPanel() {
  const [connections, setConnections] = useState<ConnectionListItem[]>([]);
  const [selected, setSelected] = useState<ConnectionDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Form state
  const [dbType, setDbType] = useState<DbType>("postgresql");
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("5432");
  const [formDb, setFormDb] = useState("");
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formSsl, setFormSsl] = useState("disable");
  const [formFilePath, setFormFilePath] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Advanced: MCP Toolbox
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formToolboxUrl, setFormToolboxUrl] = useState("");

  // Edit mode
  const [editingId, setEditingId] = useState<number | null>(null);

  const loadConnections = async () => {
    try { setConnections(await apiGet<ConnectionListItem[]>("/api/v1/connections")); }
    catch { /* ignore */ }
  };

  useEffect(() => { loadConnections(); }, []);

  const showMsg = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  const resetForm = () => {
    setFormName(""); setFormHost(""); setFormPort(DB_CONFIGS[dbType].defaultPort?.toString() || "");
    setFormDb(""); setFormUser(""); setFormPass("");
    setFormSsl("disable"); setFormFilePath(""); setFormToolboxUrl("");
  };

  const handleCreate = async () => {
    if (!formName.trim()) { showMsg("Please enter a connection name", "error"); return; }

    const useToolbox = showAdvanced && formToolboxUrl.trim();

    // Validate required fields
    if (!useToolbox) {
      if (dbType === "sqlite" && !formFilePath.trim()) { showMsg("Please enter the database file path", "error"); return; }
      if (dbType !== "sqlite" && !formHost.trim()) { showMsg("Please enter the host", "error"); return; }
    }

    const body: ConnectionCreate = {
      name: formName.trim(),
      connection_type: useToolbox ? "toolbox" : "direct",
      source_type: dbType,
    };

    if (useToolbox) {
      body.toolbox_url = formToolboxUrl.trim();
    } else if (dbType === "sqlite") {
      body.file_path = formFilePath.trim();
    } else {
      body.host = formHost.trim();
      body.port = formPort ? parseInt(formPort) : DB_CONFIGS[dbType].defaultPort;
      body.database_name = formDb.trim() || undefined;
      body.username = formUser.trim() || undefined;
      body.password = formPass || undefined;
      body.ssl_mode = formSsl !== "disable" ? formSsl : undefined;
    }

    setCreating(true);
    try {
      const result = editingId
        ? await apiPatch<ConnectionDetail>(`/api/v1/connections/${editingId}`, body)
        : await apiPost<ConnectionDetail & { test_result?: { ok: boolean; message: string } }>("/api/v1/connections", body);

      if (editingId) {
        showMsg(`Updated ${result.name}. Re-sync schema to refresh.`, "success");
      } else {
        const testOk = (result as { test_result?: { ok: boolean } }).test_result?.ok;
        const testMsg = (result as { test_result?: { message: string } }).test_result?.message;
        if (testOk) {
          showMsg(`Connected to ${result.name} successfully`, "success");
        } else {
          showMsg(`Connection saved but test failed: ${testMsg || "Unknown error"}.`, "error");
        }
      }
      resetForm();
      setEditingId(null);
      await loadConnections();
      setSelected(result);
    } catch (e) {
      showMsg(e instanceof Error ? e.message : "Failed to save connection", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleSelect = async (id: number) => {
    try { setSelected(await apiGet<ConnectionDetail>(`/api/v1/connections/${id}`)); }
    catch { /* ignore */ }
  };

  const handleTest = async (id: number) => {
    setTesting(true);
    try {
      const res = await apiPost<{ ok: boolean; message?: string }>(`/api/v1/connections/${id}/test`);
      showMsg(res.message || "Connection successful", "success");
    } catch (e) {
      showMsg(e instanceof Error ? e.message : "Test failed", "error");
    } finally { setTesting(false); }
  };

  const handleSync = async (id: number) => {
    setSyncing(true); setMessage(null);
    try {
      setSelected(await apiPost<ConnectionDetail>(`/api/v1/connections/${id}/sync-schema`));
      showMsg("Schema synced and profiled", "success");
      await loadConnections();
    } catch (e) {
      showMsg(e instanceof Error ? e.message : "Sync failed", "error");
    } finally { setSyncing(false); }
  };

  const handleEdit = (c: ConnectionDetail) => {
    setEditingId(c.id);
    setFormName(c.name);
    setDbType((c.source_type as DbType) || "postgresql");
    setFormHost(c.host || "");
    setFormPort(c.port?.toString() || "");
    setFormDb(c.database_name || "");
    setFormUser(c.username || "");
    setFormPass("");  // never prefill password for security
    setFormSsl(c.ssl_mode || "disable");
    setFormFilePath(c.file_path || "");
    setFormToolboxUrl(c.toolbox_url && !c.toolbox_url.includes("/toolbox/") ? c.toolbox_url : "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleDelete = async (id: number) => {
    try {
      await apiDelete(`/api/v1/connections/${id}`);
      if (selected?.id === id) setSelected(null);
      await loadConnections();
    } catch { /* ignore */ }
  };

  const dbConfig = DB_CONFIGS[dbType];

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-96 border-r flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-lg font-bold tracking-tight">Connections</h2>
          <p className="text-xs text-muted-foreground mt-1">Connect your databases</p>
        </div>

        {/* New connection form — on top */}
        <div className="border-b bg-muted/20 p-4 space-y-3 max-h-[60%] overflow-auto">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {editingId ? "Edit Connection" : "New Connection"}
            </p>
            {editingId && (
              <button onClick={handleCancelEdit} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                <X className="h-3 w-3" /> Cancel
              </button>
            )}
          </div>

          {/* Connection name */}
          <Input placeholder="Connection name (e.g. Production DB)" value={formName} onChange={(e) => setFormName(e.target.value)} className="h-9 text-sm rounded-lg" />

          {/* Database type selector */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Database Type</label>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.entries(DB_CONFIGS) as [DbType, (typeof DB_CONFIGS)[DbType]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { setDbType(key); setFormPort(cfg.defaultPort?.toString() || ""); }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[10px] transition-all ${
                    dbType === key ? "border-primary bg-primary/5 font-semibold" : "border-border hover:bg-muted"
                  }`}
                >
                  <span className="text-base">{cfg.icon}</span>
                  <span className="truncate w-full text-center">{cfg.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Database-specific credential fields */}
          {dbType === "sqlite" ? (
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Database File Path</label>
              <Input placeholder="/path/to/database.db" value={formFilePath} onChange={(e) => setFormFilePath(e.target.value)} className="h-9 text-sm rounded-lg font-mono mt-0.5" />
            </div>
          ) : (
            <div className="space-y-2">
              {/* Host + Port */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Host</label>
                  <Input placeholder="localhost or db.example.com" value={formHost} onChange={(e) => setFormHost(e.target.value)} className="h-9 text-sm rounded-lg mt-0.5" />
                </div>
                <div className="w-20">
                  <label className="text-[11px] font-medium text-muted-foreground">Port</label>
                  <Input placeholder={dbConfig.defaultPort?.toString()} value={formPort} onChange={(e) => setFormPort(e.target.value)} className="h-9 text-sm rounded-lg mt-0.5 font-mono" />
                </div>
              </div>

              {/* Database name */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Database Name</label>
                <Input placeholder="my_database" value={formDb} onChange={(e) => setFormDb(e.target.value)} className="h-9 text-sm rounded-lg mt-0.5" />
              </div>

              {/* Username + Password */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Username</label>
                  <Input placeholder={dbType === "postgresql" ? "postgres" : dbType === "mysql" ? "root" : "sa"} value={formUser} onChange={(e) => setFormUser(e.target.value)} className="h-9 text-sm rounded-lg mt-0.5" />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Password</label>
                  <div className="relative mt-0.5">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={formPass}
                      onChange={(e) => setFormPass(e.target.value)}
                      className="h-9 text-sm rounded-lg pr-8"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* SSL Mode */}
              {(dbType === "postgresql" || dbType === "mysql") && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">SSL Mode</label>
                  <select value={formSsl} onChange={(e) => setFormSsl(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background h-9 mt-0.5">
                    {SSL_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Advanced: MCP Toolbox */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Advanced: Connect via MCP Toolbox
            </button>
            {showAdvanced && (
              <div className="mt-2 p-3 rounded-lg border border-dashed border-border bg-muted/20 space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  If you have an MCP Toolbox server running, enter its URL here instead of database credentials.
                </p>
                <Input placeholder="http://localhost:5000" value={formToolboxUrl} onChange={(e) => setFormToolboxUrl(e.target.value)} className="h-9 text-sm rounded-lg font-mono" />
              </div>
            )}
          </div>

          <Button onClick={handleCreate} className="w-full rounded-lg shadow-sm" size="sm" disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : editingId ? <Save className="h-4 w-4 mr-2" />
              : <Plus className="h-4 w-4 mr-2" />}
            {creating ? "Saving..." : editingId ? "Save Changes" : "Add Connection"}
          </Button>
        </div>

        {/* Connected databases — below the form */}
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {connections.length > 0 && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-1 pb-2">
              Connected ({connections.length})
            </p>
          )}
          {connections.map((c) => {
            const cfg = DB_CONFIGS[c.source_type as DbType] || { label: c.source_type, color: "bg-gray-500", icon: "📦" };
            return (
              <button
                key={c.id}
                onClick={() => handleSelect(c.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selected?.id === c.id ? "border-primary/30 bg-primary/5 shadow-sm" : "border-transparent hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-9 w-9 rounded-lg ${cfg.color} flex items-center justify-center shadow-sm text-base`}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {cfg.label}
                      {c.host ? ` — ${c.host}` : ""}
                      {c.database_name ? `/${c.database_name}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.has_schema ? <Wifi className="h-3 w-3 text-emerald-500" /> : <WifiOff className="h-3 w-3 text-muted-foreground/40" />}
                    <button className="p-1 rounded hover:bg-destructive/10 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}>
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              </button>
            );
          })}
          {connections.length === 0 && (
            <div className="text-center py-8 text-muted-foreground/50">
              <Database className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No connections yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-auto">
        {message && (
          <div className={`mx-6 mt-4 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {message.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {message.text}
          </div>
        )}

        {selected ? (
          <div className="p-6 space-y-6">
            {(() => {
              const cfg = DB_CONFIGS[selected.source_type as DbType] || { label: selected.source_type, color: "bg-gray-500", icon: "📦" };
              return (
                <>
                  <div className="flex items-center gap-4">
                    <div className={`h-12 w-12 rounded-xl ${cfg.color} flex items-center justify-center shadow-md text-2xl`}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1">
                      <h2 className="text-xl font-bold tracking-tight">{selected.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {selected.connection_type === "toolbox" ? (
                          <>MCP Toolbox — {selected.toolbox_url}</>
                        ) : selected.source_type === "sqlite" ? (
                          <>SQLite — {selected.file_path}</>
                        ) : (
                          <>{cfg.label} — {selected.username || "user"}@{selected.host}:{selected.port}/{selected.database_name}</>
                        )}
                      </p>
                    </div>
                    <Badge variant="secondary" className="rounded-full px-3">{cfg.label}</Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="rounded-lg" onClick={() => handleTest(selected.id)} disabled={testing}>
                      {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      Test Connection
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg" onClick={() => handleEdit(selected)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </Button>
                    <Button size="sm" className="rounded-lg shadow-sm" onClick={() => handleSync(selected.id)} disabled={syncing}>
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      Sync Schema
                    </Button>
                  </div>

                  {/* Connection details */}
                  {selected.connection_type !== "toolbox" && selected.source_type !== "sqlite" && (
                    <Card className="shadow-sm">
                      <CardContent className="pt-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div><span className="text-muted-foreground text-xs">Host</span><p className="font-mono">{selected.host || "—"}</p></div>
                          <div><span className="text-muted-foreground text-xs">Port</span><p className="font-mono">{selected.port || "—"}</p></div>
                          <div><span className="text-muted-foreground text-xs">Database</span><p className="font-mono">{selected.database_name || "—"}</p></div>
                          <div><span className="text-muted-foreground text-xs">Username</span><p className="font-mono">{selected.username || "—"}</p></div>
                          {selected.ssl_mode && (
                            <div><span className="text-muted-foreground text-xs">SSL</span><p>{selected.ssl_mode}</p></div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Database Schema</h3>
                    <SchemaViewer schema={selected.schema_cache} profile={selected.schema_profile} />
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Database className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">Select a connection to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
