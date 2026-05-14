"use client";

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, LayoutDashboard, Loader2, CheckCircle2 } from "lucide-react";
import { apiGet, apiPost } from "@/app/lib/api";
import type { DashboardListItem } from "@/app/lib/types";

interface PinToDashboardDialogProps {
  open: boolean;
  onClose: () => void;
  queryId: number;
  defaultTitle?: string;
}

export default function PinToDashboardDialog({
  open, onClose, queryId, defaultTitle,
}: PinToDashboardDialogProps) {
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);
  const [panelTitle, setPanelTitle] = useState(defaultTitle || "");
  const [newDashboardTitle, setNewDashboardTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPanelTitle(defaultTitle || "");
      setDone(null);
      apiGet<DashboardListItem[]>("/api/v1/dashboards").then(setDashboards).catch(() => {});
    }
  }, [open, defaultTitle]);

  const pinTo = async (dashboardId: number, dashboardTitle: string) => {
    if (!panelTitle.trim()) return;
    setPinning(true);
    try {
      await apiPost(`/api/v1/dashboards/${dashboardId}/panels`, {
        query_id: queryId,
        title: panelTitle.trim(),
      });
      setDone(dashboardTitle);
      setTimeout(() => { onClose(); setDone(null); }, 1500);
    } catch { /* ignore */ }
    finally { setPinning(false); }
  };

  const createAndPin = async () => {
    if (!newDashboardTitle.trim() || !panelTitle.trim()) return;
    setCreating(true);
    try {
      const dash = await apiPost<{ id: number; title: string }>("/api/v1/dashboards", {
        title: newDashboardTitle.trim(),
        description: "",
      });
      await pinTo(dash.id, dash.title);
      setNewDashboardTitle("");
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pin to Dashboard</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-6 text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">Pinned to <span className="text-primary">{done}</span></p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Panel title */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Panel Title</label>
              <Input
                value={panelTitle}
                onChange={(e) => setPanelTitle(e.target.value)}
                placeholder="e.g. Revenue by region"
                className="rounded-lg text-sm"
              />
            </div>

            {/* Existing dashboards */}
            {dashboards.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Add to existing dashboard
                </label>
                <div className="space-y-1.5 max-h-48 overflow-auto pr-1">
                  {dashboards.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => pinTo(d.id, d.title)}
                      disabled={pinning || !panelTitle.trim()}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-border hover:bg-muted hover:border-primary/30 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <LayoutDashboard className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.title}</p>
                        <p className="text-[10px] text-muted-foreground">{d.panel_count} panels</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Create new dashboard */}
            <div className="pt-3 border-t">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Or create a new dashboard
              </label>
              <div className="flex gap-2">
                <Input
                  value={newDashboardTitle}
                  onChange={(e) => setNewDashboardTitle(e.target.value)}
                  placeholder="New dashboard name"
                  className="rounded-lg text-sm"
                />
                <Button
                  onClick={createAndPin}
                  disabled={creating || !newDashboardTitle.trim() || !panelTitle.trim()}
                  size="sm"
                  className="rounded-lg shrink-0"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
