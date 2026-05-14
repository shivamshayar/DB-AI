"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, LayoutDashboard, Trash2, BarChart3, Calendar, ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import ChartPanel from "@/app/components/ChartPanel";
import { apiGet, apiPost, apiDelete } from "@/app/lib/api";
import type { DashboardListItem, DashboardCreate, DashboardDetail } from "@/app/lib/types";

export default function DashboardsPanel() {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedDash, setSelectedDash] = useState<DashboardDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboards = async () => {
    try { setDashboards(await apiGet<DashboardListItem[]>("/api/v1/dashboards")); }
    catch { /* ignore */ }
  };

  useEffect(() => { loadDashboards(); }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    try {
      await apiPost<{ id: number }>("/api/v1/dashboards", {
        title: title.trim(), description: description.trim(),
      } satisfies DashboardCreate);
      setTitle(""); setDescription(""); setOpen(false);
      await loadDashboards();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDelete(`/api/v1/dashboards/${id}`);
      if (selectedDash?.id === id) setSelectedDash(null);
      await loadDashboards();
    } catch { /* ignore */ }
  };

  const handleSelect = async (id: number) => {
    try { setSelectedDash(await apiGet<DashboardDetail>(`/api/v1/dashboards/${id}`)); }
    catch { /* ignore */ }
  };

  const handleRemovePanel = async (dashId: number, panelId: number) => {
    try {
      await apiDelete(`/api/v1/dashboards/${dashId}/panels/${panelId}`);
      await handleSelect(dashId);
    } catch { /* ignore */ }
  };

  // Detail view
  if (selectedDash) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedDash(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold flex-1">{selectedDash.title}</h3>
          <Button variant="outline" size="sm" className="rounded-lg" onClick={async () => {
            setRefreshing(true);
            try {
              const fresh = await apiPost<DashboardDetail>(`/api/v1/dashboards/${selectedDash.id}/refresh`);
              setSelectedDash(fresh);
            } catch { /* ignore */ }
            finally { setRefreshing(false); }
          }} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
        {selectedDash.panels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedDash.panels.map((panel) => (
              <div key={panel.id} className="relative group">
                <ChartPanel chartSpec={panel.chart_spec} resultData={panel.result_data} title={panel.title} />
                <Button variant="destructive" size="icon"
                  className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemovePanel(selectedDash.id, panel.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No panels yet. Use Chat to create queries and pin them here.</p>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button className="rounded-xl shadow-sm" size="sm">
              <Plus className="h-4 w-4 mr-2" /> Create Dashboard
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Dashboard</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-lg" />
              <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-lg" />
              <Button onClick={handleCreate} className="w-full rounded-lg">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {dashboards.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dashboards.map((d) => (
            <Card key={d.id} className="cursor-pointer group hover:shadow-md hover:border-primary/20 transition-all"
              onClick={() => handleSelect(d.id)}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-primary" />
                  </div>
                  <button className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all"
                    onClick={(e) => handleDelete(d.id, e)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
                <h3 className="font-semibold text-sm mb-1">{d.title}</h3>
                {d.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{d.description}</p>}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 pt-2 border-t border-border/50">
                  <span className="flex items-center gap-1"><LayoutDashboard className="h-3 w-3" /> {d.panel_count} panels</span>
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(d.created_at).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <LayoutDashboard className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <h3 className="font-semibold mb-1">No dashboards yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create one to pin your charts.</p>
          <Button variant="outline" className="rounded-xl" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Create your first dashboard
          </Button>
        </div>
      )}
    </div>
  );
}
