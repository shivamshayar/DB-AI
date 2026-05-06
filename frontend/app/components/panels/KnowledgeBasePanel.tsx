"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Trash2, Search, FileText, BookOpen, FileType2, CheckCircle2, AlertCircle } from "lucide-react";
import FileUploader from "@/app/components/FileUploader";
import { apiGet, apiUpload, apiDelete, apiPost } from "@/app/lib/api";
import type { KbDocument, KbSearchResult } from "@/app/lib/types";

const FILE_ICONS: Record<string, string> = {
  pdf: "bg-red-500",
  txt: "bg-blue-500",
  md: "bg-purple-500",
  csv: "bg-emerald-500",
};

export default function KnowledgeBasePanel() {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const loadDocs = async () => {
    try { setDocuments(await apiGet<KbDocument[]>("/api/v1/kb/documents")); }
    catch { /* ignore */ }
  };

  useEffect(() => { loadDocs(); }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);
      await apiUpload<KbDocument>("/api/v1/kb/documents", formData);
      await loadDocs();
    } catch { /* ignore */ }
    finally { setUploading(false); }
  };

  const handleDelete = async (id: number) => {
    try { await apiDelete(`/api/v1/kb/documents/${id}`); await loadDocs(); }
    catch { /* ignore */ }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      setSearchResults(await apiPost<KbSearchResult[]>("/api/v1/kb/search", { query: searchQuery, top_k: 5 }));
    } catch { /* ignore */ }
    finally { setSearching(false); }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Knowledge Base</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload domain documents — formulas, business rules, KPI definitions — to improve query accuracy.
        </p>
      </div>

      {/* Upload */}
      <FileUploader onUpload={handleUpload} uploading={uploading} />

      {/* Document list */}
      {documents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Uploaded Documents ({documents.length})
          </h3>
          {documents.map((doc) => (
            <Card key={doc.id} className="shadow-sm hover:shadow transition-shadow">
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`h-10 w-10 rounded-xl ${FILE_ICONS[doc.file_type] || "bg-gray-500"} flex items-center justify-center shadow-sm shrink-0`}>
                  <FileType2 className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">{doc.file_name}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {doc.status === "ready" ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                    </span>
                  ) : doc.status === "error" ? (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5" /> Error
                    </span>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] rounded-full">{doc.status}</Badge>
                  )}
                  <button
                    className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
                    onClick={() => handleDelete(doc.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Separator />

      {/* Test search */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Test Search
        </h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <Input
              placeholder="Search your knowledge base..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9 rounded-xl"
            />
          </div>
          <Button onClick={handleSearch} disabled={searching} className="rounded-xl">
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>
        {searchResults.length > 0 && (
          <div className="space-y-2">
            {searchResults.map((r, i) => (
              <Card key={i} className="shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <BookOpen className="h-3 w-3 text-primary" />
                      {r.document_title}
                      {r.page_number ? <span className="text-muted-foreground">p.{r.page_number}</span> : null}
                    </span>
                    <Badge variant="secondary" className="text-[10px] rounded-full">
                      {(r.score * 100).toFixed(0)}% match
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{r.chunk_text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
