"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Database, BookOpen, Tags, LayoutDashboard, Settings,
  Sparkles, Plus, MessageSquare, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import FullScreenModal from "./FullScreenModal";
import { apiGet, apiDelete } from "@/app/lib/api";
import type { ChatThread } from "@/app/lib/types";

// Lazy-import modal contents to avoid circular deps
import dynamic from "next/dynamic";
const ConnectionsContent = dynamic(() => import("@/app/components/panels/ConnectionsPanel"), { ssr: false });
const KnowledgeBaseContent = dynamic(() => import("@/app/components/panels/KnowledgeBasePanel"), { ssr: false });
const MetadataContent = dynamic(() => import("@/app/components/panels/MetadataPanel"), { ssr: false });
const DashboardsContent = dynamic(() => import("@/app/components/panels/DashboardsPanel"), { ssr: false });
const SettingsContent = dynamic(() => import("@/app/components/panels/SettingsPanel"), { ssr: false });

type ModalType = "connections" | "knowledge-base" | "metadata" | "dashboards" | "settings" | null;

const menuItems: { key: ModalType; label: string; icon: typeof Database }[] = [
  { key: "connections", label: "Connections", icon: Database },
  { key: "knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { key: "metadata", label: "Metadata", icon: Tags },
  { key: "dashboards", label: "Dashboards", icon: LayoutDashboard },
  { key: "settings", label: "Settings", icon: Settings },
];

const modalTitles: Record<string, string> = {
  connections: "Database Connections",
  "knowledge-base": "Knowledge Base",
  metadata: "Table & Column Metadata",
  dashboards: "Dashboards",
  settings: "Settings",
};

interface AppShellProps {
  children: React.ReactNode;
  threads: ChatThread[];
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
  onNewChat: () => void;
  onRefreshThreads: () => void;
}

export default function AppShell({
  children, threads, activeThreadId, onSelectThread, onNewChat, onRefreshThreads,
}: AppShellProps) {
  const [openModal, setOpenModal] = useState<ModalType>(null);

  const handleDeleteThread = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDelete(`/api/v1/queries/threads/${id}`);
      onRefreshThreads();
    } catch { /* ignore */ }
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar — threads only */}
      <aside className="w-60 shrink-0 flex flex-col bg-sidebar text-sidebar-foreground">
        {/* Brand */}
        <div className="px-4 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-sidebar-primary flex items-center justify-center shadow-lg shadow-sidebar-primary/30">
              <Sparkles className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-sidebar-accent-foreground">DB Dashboard</h1>
            </div>
          </div>
        </div>

        {/* New Chat button */}
        <div className="px-3 pb-2">
          <Button
            onClick={onNewChat}
            variant={activeThreadId === null ? "default" : "outline"}
            className="w-full rounded-lg text-xs h-8 justify-start gap-2"
            size="sm"
          >
            <Plus className="h-3.5 w-3.5" /> New Chat
          </Button>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-auto px-2 space-y-0.5">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelectThread(t.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors group flex items-start gap-2 ${
                activeThreadId === t.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 opacity-40" />
              <span className="flex-1 min-w-0 truncate font-medium leading-tight">{t.title}</span>
              <button
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-all shrink-0"
                onClick={(e) => handleDeleteThread(t.id, e)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </button>
          ))}
          {threads.length === 0 && (
            <p className="text-center py-6 text-[10px] text-sidebar-foreground/30">No conversations yet</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-[9px] text-sidebar-foreground/25">Powered by Ollama</p>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header with menu icons */}
        <header className="h-12 shrink-0 border-b bg-background/80 backdrop-blur-sm flex items-center justify-between px-4">
          <div />
          <nav className="flex items-center gap-1">
            {menuItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setOpenModal(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  openModal === key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>
        </header>

        {/* Chat content */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>

      {/* Modals */}
      {openModal && (
        <FullScreenModal
          open={true}
          onClose={() => setOpenModal(null)}
          title={modalTitles[openModal] || ""}
        >
          {openModal === "connections" && <ConnectionsContent />}
          {openModal === "knowledge-base" && <KnowledgeBaseContent />}
          {openModal === "metadata" && <MetadataContent />}
          {openModal === "dashboards" && <DashboardsContent />}
          {openModal === "settings" && <SettingsContent />}
        </FullScreenModal>
      )}
    </div>
  );
}
