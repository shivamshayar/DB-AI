"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Code, ChevronDown, ChevronUp, MessageCircleQuestion,
  Database, Table2, Zap, ArrowRight,
} from "lucide-react";
import QueryInput from "@/app/components/QueryInput";
import ChartPanel from "@/app/components/ChartPanel";
import ResultTable from "@/app/components/ResultTable";
import { apiPost, apiGet } from "@/app/lib/api";
import type { QueryResult, QueryRequest, ChatThreadDetail } from "@/app/lib/types";

export default function ChatPage() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<QueryResult[]>([]);
  const [expandedSql, setExpandedSql] = useState<Set<number>>(new Set());
  const [expandedData, setExpandedData] = useState<Set<number>>(new Set());

  // Listen for thread events from AppShell (via layout)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.type === "load-thread") {
        loadThread(detail.threadId);
      }
      if (detail.type === "new-chat") {
        setActiveThreadId(null);
        setMessages([]);
      }
    };
    window.addEventListener("thread-event", handler);
    return () => window.removeEventListener("thread-event", handler);
  }, []);

  const loadThread = async (threadId: number) => {
    try {
      const detail = await apiGet<ChatThreadDetail>(`/api/v1/queries/threads/${threadId}`);
      setActiveThreadId(threadId);
      setMessages(detail.messages);
    } catch { /* ignore */ }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const notifyLayout = (type: string, data?: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent("thread-event", { detail: { type, ...data } }));
  };

  const handleSubmit = async (question: string) => {
    setLoading(true);
    const optimistic: QueryResult = {
      id: -Date.now(), thread_id: activeThreadId, question,
      connection_id: null, sql_generated: null, chart_spec: null,
      result_data: null, explanation: null, intent: null,
      clarification: null, status: "running", error_message: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const result = await apiPost<QueryResult>("/api/v1/queries", {
        question, thread_id: activeThreadId,
      } satisfies QueryRequest);

      if (!activeThreadId && result.thread_id) {
        setActiveThreadId(result.thread_id);
        notifyLayout("set-active-thread", { threadId: result.thread_id });
      }
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? result : m));
      notifyLayout("refresh-threads");
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id
            ? { ...optimistic, status: "error", error_message: e instanceof Error ? e.message : "Failed" }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClarificationClick = (value: string) => {
    if (value.startsWith("__navigate:")) { router.push(value.replace("__navigate:", "")); return; }
    handleSubmit(value);
  };

  const toggleSql = (id: number) =>
    setExpandedSql((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleData = (id: number) =>
    setExpandedData((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const showWelcome = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {showWelcome && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
              <Zap className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1.5">What would you like to know?</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Ask questions about your data. I&apos;ll generate SQL and show you charts.
            </p>
            <div className="grid grid-cols-2 gap-2.5 max-w-md w-full">
              {["Show me all tables", "What databases are connected?", "What is the total revenue?", "How many rows in each table?"].map((q) => (
                <button key={q} onClick={() => handleSubmit(q)}
                  className="text-left px-3.5 py-2.5 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/20 transition-all text-xs group">
                  <span className="text-muted-foreground group-hover:text-foreground">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-3">
                {/* User */}
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[11px] font-bold text-primary-foreground">U</span>
                  </div>
                  <p className="text-sm font-medium pt-1 leading-relaxed">{msg.question}</p>
                </div>

                {/* Response */}
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    {msg.status === "running" && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> Thinking...
                      </div>
                    )}

                    {msg.status === "error" && msg.error_message && (
                      <Card className="border-destructive/30 bg-destructive/5">
                        <CardContent className="py-3 text-sm text-destructive">{msg.error_message}</CardContent>
                      </Card>
                    )}

                    {msg.status === "clarification" && msg.clarification && (
                      <Card className="border-primary/20 bg-primary/5">
                        <CardContent className="py-3 space-y-2.5">
                          <p className="text-sm flex items-center gap-2">
                            <MessageCircleQuestion className="h-4 w-4 text-primary shrink-0" />
                            {msg.clarification.message}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.clarification.options.map((opt, i) => (
                              <Button key={i} variant="outline" size="sm"
                                className="text-xs rounded-full border-primary/20 hover:bg-primary/10 h-7"
                                onClick={() => handleClarificationClick(opt.value)} disabled={loading}>
                                {opt.label} <ArrowRight className="h-3 w-3 ml-1 opacity-50" />
                              </Button>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {msg.status === "completed" && (
                      <>
                        {msg.intent && (
                          <Badge variant="secondary" className="text-[10px] rounded-full px-2.5 py-0">
                            {msg.intent === "meta_query" ? <><Database className="h-2.5 w-2.5 mr-1" /> Schema</> : <><Table2 className="h-2.5 w-2.5 mr-1" /> Query</>}
                          </Badge>
                        )}
                        {msg.chart_spec && msg.result_data && (
                          <ChartPanel chartSpec={msg.chart_spec} resultData={msg.result_data} title={msg.chart_spec.title} />
                        )}
                        {msg.result_data && !msg.chart_spec && (
                          <Card className="shadow-sm"><CardContent className="py-3"><ResultTable data={msg.result_data} /></CardContent></Card>
                        )}
                        {msg.explanation && <p className="text-sm text-muted-foreground leading-relaxed">{msg.explanation}</p>}
                        {msg.sql_generated && (
                          <button onClick={() => toggleSql(msg.id)} className="w-full text-left">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1">
                              <Code className="h-3 w-3" /> SQL {expandedSql.has(msg.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </div>
                            {expandedSql.has(msg.id) && (
                              <pre className="text-xs bg-sidebar text-sidebar-foreground p-3 rounded-lg overflow-x-auto font-mono leading-relaxed mt-1">{msg.sql_generated}</pre>
                            )}
                          </button>
                        )}
                        {msg.result_data && msg.chart_spec && (
                          <button onClick={() => toggleData(msg.id)} className="w-full text-left">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1">
                              Raw data ({msg.result_data.rows.length} rows) {expandedData.has(msg.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </div>
                            {expandedData.has(msg.id) && <div className="mt-1"><ResultTable data={msg.result_data} /></div>}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input — pinned to bottom */}
      <div className="shrink-0 border-t bg-background/80 backdrop-blur-sm px-6 py-3">
        <div className="max-w-4xl mx-auto">
          <QueryInput onSubmit={handleSubmit} loading={loading} />
        </div>
      </div>
    </div>
  );
}
