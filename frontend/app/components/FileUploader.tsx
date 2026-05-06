"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Loader2, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileUploaderProps {
  onUpload: (file: File) => Promise<void>;
  accept?: string;
  uploading?: boolean;
}

const ALLOWED = ".pdf,.txt,.md,.csv";

export default function FileUploader({
  onUpload,
  accept = ALLOWED,
  uploading = false,
}: FileUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => { await onUpload(file); }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200 ${
        dragActive
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-border hover:border-primary/30 hover:bg-muted/30"
      }`}
    >
      {uploading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
          <p className="text-sm font-medium">Processing file...</p>
          <p className="text-xs text-muted-foreground">Extracting text and building embeddings</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FileUp className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">Drop files here or browse</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, TXT, MD, CSV up to 10MB</p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => inputRef.current?.click()}>
            <FileText className="h-4 w-4 mr-2" /> Browse Files
          </Button>
          <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
        </div>
      )}
    </div>
  );
}
