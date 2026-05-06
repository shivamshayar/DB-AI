"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2, Sparkles } from "lucide-react";

interface QueryInputProps {
  onSubmit: (question: string) => void;
  loading?: boolean;
  placeholder?: string;
}

export default function QueryInput({
  onSubmit,
  loading = false,
  placeholder = "Ask anything about your data... e.g. \"What is the monthly revenue trend?\"",
}: QueryInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const q = value.trim();
    if (!q || loading) return;
    onSubmit(q);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-primary/30">
        <div className="flex items-center pl-3 pb-1.5 text-muted-foreground/50">
          <Sparkles className="h-4 w-4" />
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 py-1.5 min-h-[36px] max-h-[120px]"
          disabled={loading}
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <Button
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
          size="icon"
          className="h-9 w-9 rounded-xl shrink-0 shadow-sm"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      {loading && (
        <div className="absolute -bottom-6 left-0 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex gap-0.5">
            <span className="animate-bounce [animation-delay:0ms]">.</span>
            <span className="animate-bounce [animation-delay:150ms]">.</span>
            <span className="animate-bounce [animation-delay:300ms]">.</span>
          </span>
          Thinking...
        </div>
      )}
    </div>
  );
}
