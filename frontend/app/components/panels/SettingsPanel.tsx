"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, XCircle, Loader2, Eye, EyeOff, Save, Zap,
} from "lucide-react";
import { apiGet, apiPut, apiPost } from "@/app/lib/api";
import type { LlmConfig, LlmProvider, LlmTestResult } from "@/app/lib/types";

const PROVIDERS: {
  key: LlmProvider;
  label: string;
  icon: string;
  description: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  modelSuggestions: string[];
}[] = [
  {
    key: "ollama",
    label: "Ollama",
    icon: "🦙",
    description: "Run models locally — free, private, offline.",
    defaultModel: "llama3.2",
    defaultBaseUrl: "http://localhost:11434",
    needsApiKey: false,
    needsBaseUrl: true,
    modelSuggestions: ["llama3.2", "llama3", "qwen2.5:7b", "mistral", "phi3"],
  },
  {
    key: "openai",
    label: "OpenAI",
    icon: "🤖",
    description: "GPT-4o, GPT-4 Turbo. Paid API.",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsApiKey: true,
    needsBaseUrl: true,
    modelSuggestions: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  {
    key: "anthropic",
    label: "Anthropic Claude",
    icon: "🧠",
    description: "Claude Sonnet, Claude Opus. Best reasoning.",
    defaultModel: "claude-sonnet-4-20250514",
    needsApiKey: true,
    needsBaseUrl: false,
    modelSuggestions: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-latest"],
  },
];

export default function SettingsPanel() {
  const [config, setConfig] = useState<LlmConfig>({
    provider: "ollama",
    model: "llama3.2",
    api_key: "",
    base_url: "http://localhost:11434",
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    apiGet<LlmConfig>("/api/v1/settings/llm")
      .then((c) => { setConfig(c); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const showMsg = (text: string, ok: boolean) => {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 5000);
  };

  const currentProvider = PROVIDERS.find((p) => p.key === config.provider)!;

  const handleProviderChange = (key: LlmProvider) => {
    const p = PROVIDERS.find((x) => x.key === key)!;
    setConfig({
      provider: key,
      model: p.defaultModel,
      api_key: config.provider === key ? config.api_key : "",
      base_url: p.defaultBaseUrl || "",
    });
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const result = await apiPost<LlmTestResult>("/api/v1/settings/llm/test", config);
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPut<LlmConfig>("/api/v1/settings/llm", config);
      showMsg("Settings saved. New queries will use this provider.", true);
    } catch (e) {
      showMsg(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-6 mx-auto">
      <div>
        <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" /> LLM Provider
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the AI provider to power text-to-SQL generation. Changes take effect immediately.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.key}
            onClick={() => handleProviderChange(p.key)}
            className={`text-left p-4 rounded-xl border-2 transition-all ${
              config.provider === p.key
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/30 hover:bg-muted/30"
            }`}
          >
            <div className="text-2xl mb-2">{p.icon}</div>
            <div className="font-semibold text-sm">{p.label}</div>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{p.description}</p>
          </button>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <span>{currentProvider.icon}</span> {currentProvider.label} Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Model</label>
            <Input
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={currentProvider.defaultModel}
              className="rounded-lg font-mono text-sm"
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {currentProvider.modelSuggestions.map((m) => (
                <button
                  key={m}
                  onClick={() => setConfig({ ...config, model: m })}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    config.model === m
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {currentProvider.needsApiKey && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">API Key</label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={config.api_key}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                  placeholder={
                    config.provider === "openai" ? "sk-..."
                    : config.provider === "anthropic" ? "sk-ant-..."
                    : ""
                  }
                  className="rounded-lg font-mono text-sm pr-9"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {config.provider === "openai" && "Get your key at platform.openai.com/api-keys"}
                {config.provider === "anthropic" && "Get your key at console.anthropic.com"}
              </p>
            </div>
          )}

          {currentProvider.needsBaseUrl && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Base URL {config.provider !== "ollama" && "(optional)"}
              </label>
              <Input
                value={config.base_url}
                onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                placeholder={currentProvider.defaultBaseUrl}
                className="rounded-lg font-mono text-sm"
              />
              {config.provider === "ollama" && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Make sure Ollama is running: <code className="bg-muted px-1 rounded">ollama serve</code>
                </p>
              )}
            </div>
          )}

          {testResult && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
              testResult.ok
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {testResult.ok ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <span className="leading-relaxed">{testResult.message}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            <Button size="sm" className="rounded-lg shadow-sm flex-1" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className={`px-4 py-2.5 rounded-lg text-sm ${
          message.ok
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {message.text}
        </div>
      )}

      <Card className="bg-muted/30 border-muted">
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Tips:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li><strong>Ollama</strong> is free and runs locally — good for privacy and offline use.</li>
            <li><strong>OpenAI</strong> GPT-4o-mini offers the best price/performance ratio.</li>
            <li><strong>Claude Sonnet</strong> is the most accurate for complex SQL generation.</li>
            <li>Click <strong>Test Connection</strong> before saving to verify your credentials.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
