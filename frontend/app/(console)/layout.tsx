"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/app/components/AppShell";
import { apiGet } from "@/app/lib/api";
import type { ChatThread } from "@/app/lib/types";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  const refreshThreads = useCallback(() => {
    apiGet<ChatThread[]>("/api/v1/queries/threads?limit=30").then(setThreads).catch(() => {});
  }, []);

  useEffect(() => { refreshThreads(); }, [refreshThreads]);

  // Expose thread control to child (chat page) via a global-ish pattern
  // We use a custom event to communicate between layout and page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.type === "refresh-threads") refreshThreads();
      if (detail.type === "set-active-thread") setActiveThreadId(detail.threadId);
    };
    window.addEventListener("thread-event", handler);
    return () => window.removeEventListener("thread-event", handler);
  }, [refreshThreads]);

  const handleSelectThread = (id: number) => {
    setActiveThreadId(id);
    window.dispatchEvent(new CustomEvent("thread-event", { detail: { type: "load-thread", threadId: id } }));
  };

  const handleNewChat = () => {
    setActiveThreadId(null);
    window.dispatchEvent(new CustomEvent("thread-event", { detail: { type: "new-chat" } }));
  };

  return (
    <AppShell
      threads={threads}
      activeThreadId={activeThreadId}
      onSelectThread={handleSelectThread}
      onNewChat={handleNewChat}
      onRefreshThreads={refreshThreads}
    >
      {children}
    </AppShell>
  );
}
