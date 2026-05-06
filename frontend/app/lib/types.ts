// ── Settings ────────────────────────────────────────────────

export type LlmProvider = "ollama" | "openai" | "anthropic";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  api_key: string;
  base_url: string;
}

export interface LlmTestResult {
  ok: boolean;
  message: string;
}

// ── Connections ──────────────────────────────────────────────

export interface ConnectionCreate {
  name: string;
  connection_type: "direct" | "toolbox";
  source_type: string;
  host?: string | null;
  port?: number | null;
  database_name?: string | null;
  username?: string | null;
  password?: string | null;
  ssl_mode?: string | null;
  file_path?: string | null;
  toolbox_url?: string | null;
}

export interface ConnectionListItem {
  id: number;
  name: string;
  connection_type: string;
  source_type: string;
  host: string | null;
  database_name: string | null;
  has_schema: boolean;
  created_at: string;
}

export interface ConnectionDetail {
  id: number;
  name: string;
  connection_type: string;
  source_type: string;
  host: string | null;
  port: number | null;
  database_name: string | null;
  username: string | null;
  ssl_mode: string | null;
  file_path: string | null;
  toolbox_url: string | null;
  schema_cache: SchemaCache | null;
  schema_profile: SchemaProfile | null;
  created_at: string;
}

export interface SchemaCache {
  tables: SchemaTable[];
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaColumn {
  name: string;
  type: string;
}

export interface SchemaProfile {
  tables: ProfileTable[];
}

export interface ProfileTable {
  name: string;
  row_count: number;
  sample_rows: Record<string, unknown>[];
  columns: ProfileColumn[];
}

export interface ProfileColumn {
  name: string;
  type?: string;
  distinct_count?: number;
  min?: number;
  max?: number;
  avg?: number;
  sample_values?: string[];
}

// ── Metadata ────────────────────────────────────────────────

export interface ColumnMetadataItem {
  column_name: string;
  description: string;
}

export interface TableMetadataItem {
  table_name: string;
  description: string;
  columns: ColumnMetadataItem[];
}

export interface MetadataUpdate {
  tables: TableMetadataItem[];
}

export interface MetadataResponse {
  connection_id: number;
  tables: TableMetadataItem[];
}

// ── Knowledge Base ──────────────────────────────────────────

export interface KbDocument {
  id: number;
  title: string;
  file_name: string;
  file_type: string;
  status: string;
  created_at: string;
}

export interface KbSearchResult {
  chunk_text: string;
  document_title: string;
  page_number: number | null;
  score: number;
}

// ── Queries ─────────────────────────────────────────────────

export interface QueryRequest {
  question: string;
  connection_id?: number | null;
  context?: string | null;
  thread_id?: number | null;
}

export interface ClarificationOption {
  label: string;
  value: string;
}

export interface ClarificationData {
  message: string;
  options: ClarificationOption[];
}

export interface ChatThread {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_question: string | null;
}

export interface ChatThreadDetail {
  id: number;
  title: string;
  created_at: string;
  messages: QueryResult[];
}

export interface QueryResult {
  id: number;
  thread_id: number | null;
  question: string;
  connection_id: number | null;
  sql_generated: string | null;
  chart_spec: ChartSpec | null;
  result_data: ResultData | null;
  explanation: string | null;
  intent: string | null;
  clarification: ClarificationData | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface QueryListItem {
  id: number;
  question: string;
  status: string;
  created_at: string;
}

export interface ChartSpec {
  chart_type: "bar" | "line" | "area" | "pie" | "scatter";
  title: string;
  x_axis: { field: string; label: string };
  y_axis: { field: string; label: string };
  series: { field: string; label: string; color: string }[];
}

export interface ResultData {
  columns: string[];
  rows: unknown[][];
}

// ── Dashboards ──────────────────────────────────────────────

export interface DashboardCreate {
  title: string;
  description?: string;
}

export interface DashboardListItem {
  id: number;
  title: string;
  description: string | null;
  panel_count: number;
  created_at: string;
}

export interface DashboardPanel {
  id: number;
  query_id: number;
  title: string;
  layout: { x: number; y: number; w: number; h: number } | null;
  chart_spec: ChartSpec | null;
  result_data: ResultData | null;
  created_at: string;
}

export interface DashboardDetail {
  id: number;
  title: string;
  description: string | null;
  panels: DashboardPanel[];
  created_at: string;
}
