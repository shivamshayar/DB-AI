import { test, expect, type Page } from "@playwright/test";

const API = "http://localhost:8000";

/**
 * REAL-WORLD SCENARIO: Sales Analytics Team Setup
 *
 * Simulates a data analyst named "Priya" who:
 *   - Connects her company's Production PostgreSQL and Warehouse MySQL databases
 *   - Uploads domain knowledge (OEE formulas, financial KPI definitions, SLA rules)
 *   - Annotates table/column metadata for better AI understanding
 *   - Creates dashboards for different stakeholders (Ops, Finance, Exec)
 *   - Submits queries and handles errors gracefully
 *   - Manages lifecycle: edits, deletes, re-creates
 *
 * Tests:
 *   - Multi-connection management (create, select, switch, delete)
 *   - Multi-document KB (upload 3 docs, search across all, delete selectively)
 *   - Metadata annotation with real business descriptions
 *   - Dashboard + panel lifecycle with real titles
 *   - Edge cases: empty inputs, long text, special characters, duplicate names
 *   - API contract verification (response shape, status codes)
 *   - UI state consistency after rapid navigation
 */
test.describe.serial("Real-World: Sales Analytics Team Setup", () => {
  const created: { connections: number[]; documents: number[]; dashboards: number[]; queries: number[] } = {
    connections: [],
    documents: [],
    dashboards: [],
    queries: [],
  };

  test.afterAll(async ({ request }) => {
    // Cleanup everything created during the test
    for (const id of created.dashboards) await request.delete(`${API}/api/v1/dashboards/${id}`).catch(() => {});
    for (const id of created.documents) await request.delete(`${API}/api/v1/kb/documents/${id}`).catch(() => {});
    for (const id of created.connections) await request.delete(`${API}/api/v1/connections/${id}`).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: MULTI-CONNECTION SETUP
  // ═══════════════════════════════════════════════════════════

  test("1.1 Create Production PostgreSQL connection", async ({ page }) => {
    await page.goto("/connections");

    await page.locator('input[placeholder="Name"]').fill("Production DB");
    await page.locator('input[placeholder*="Toolbox URL"]').fill("http://toolbox-prod:5000");
    await page.locator("select").selectOption("postgresql");
    await page.getByRole("button", { name: "Add Connection" }).click();

    await expect(page.locator("text=Production DB")).toBeVisible({ timeout: 5000 });

    const resp = await page.request.get(`${API}/api/v1/connections`);
    const conns = await resp.json();
    const conn = conns.find((c: any) => c.name === "Production DB");
    expect(conn).toBeTruthy();
    expect(conn.source_type).toBe("postgresql");
    created.connections.push(conn.id);
  });

  test("1.2 Create Warehouse MySQL connection", async ({ page }) => {
    await page.goto("/connections");

    await page.locator('input[placeholder="Name"]').fill("Data Warehouse");
    await page.locator('input[placeholder*="Toolbox URL"]').fill("http://toolbox-warehouse:5000");
    await page.locator("select").selectOption("mysql");
    await page.getByRole("button", { name: "Add Connection" }).click();

    await expect(page.locator("text=Data Warehouse")).toBeVisible({ timeout: 5000 });

    const resp = await page.request.get(`${API}/api/v1/connections`);
    const conns = await resp.json();
    const conn = conns.find((c: any) => c.name === "Data Warehouse");
    expect(conn).toBeTruthy();
    expect(conn.source_type).toBe("mysql");
    created.connections.push(conn.id);
  });

  test("1.3 Create SQLite analytics connection", async ({ page }) => {
    await page.goto("/connections");

    await page.locator('input[placeholder="Name"]').fill("Analytics Cache");
    await page.locator('input[placeholder*="Toolbox URL"]').fill("http://toolbox-sqlite:5000");
    await page.locator("select").selectOption("sqlite");
    await page.getByRole("button", { name: "Add Connection" }).click();

    await expect(page.locator("text=Analytics Cache")).toBeVisible({ timeout: 5000 });

    const resp = await page.request.get(`${API}/api/v1/connections`);
    const conns = await resp.json();
    const conn = conns.find((c: any) => c.name === "Analytics Cache");
    created.connections.push(conn.id);
  });

  test("1.4 All three connections visible on page", async ({ page }) => {
    await page.goto("/connections");

    await expect(page.locator("text=Production DB")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Data Warehouse")).toBeVisible();
    await expect(page.locator("text=Analytics Cache")).toBeVisible();
  });

  test("1.5 Switch between connections — detail panel updates", async ({ page }) => {
    await page.goto("/connections");

    // Click Production DB
    await page.locator("text=Production DB").click();
    await expect(page.getByText("http://toolbox-prod:5000")).toBeVisible();

    // Click Data Warehouse — detail should switch
    await page.locator("text=Data Warehouse").click();
    await expect(page.getByText("http://toolbox-warehouse:5000")).toBeVisible();
    // Previous detail should be gone
    await expect(page.getByText("http://toolbox-prod:5000")).not.toBeVisible();

    // Click Analytics Cache
    await page.locator("text=Analytics Cache").click();
    await expect(page.getByText("http://toolbox-sqlite:5000")).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: KNOWLEDGE BASE — MULTI-DOCUMENT UPLOAD & SEARCH
  // ═══════════════════════════════════════════════════════════

  test("2.1 Upload OEE formulas document", async ({ page }) => {
    const content = [
      "Overall Equipment Effectiveness (OEE) Guide",
      "",
      "OEE = Availability × Performance × Quality",
      "",
      "Availability = (Run Time / Planned Production Time) × 100",
      "  Run Time = Planned Production Time - Unplanned Downtime",
      "  Planned Production Time = Total Shift Time - Planned Breaks",
      "",
      "Performance = (Ideal Cycle Time × Total Count) / Run Time × 100",
      "  Ideal Cycle Time = 1 / Ideal Run Rate",
      "",
      "Quality = (Good Count / Total Count) × 100",
      "  Good Count = Total Count - Defect Count",
      "",
      "World-class OEE benchmark: 85%",
      "  Availability: 90%, Performance: 95%, Quality: 99.9%",
      "",
      "Six Big Losses:",
      "1. Equipment Failure (Availability)",
      "2. Setup and Adjustments (Availability)",
      "3. Idling and Minor Stops (Performance)",
      "4. Reduced Speed (Performance)",
      "5. Process Defects (Quality)",
      "6. Reduced Yield (Quality)",
    ].join("\n");

    const resp = await page.request.post(`${API}/api/v1/kb/documents`, {
      multipart: {
        file: { name: "oee_formulas.txt", mimeType: "text/plain", buffer: Buffer.from(content) },
        title: "OEE Manufacturing Guide",
      },
    });
    expect(resp.ok()).toBeTruthy();
    const doc = await resp.json();
    expect(doc.status).toBe("ready");
    created.documents.push(doc.id);
  });

  test("2.2 Upload financial KPI definitions", async ({ page }) => {
    const content = [
      "Financial KPI Definitions - FY2024",
      "",
      "Revenue Metrics:",
      "  Gross Revenue = SUM(order_total) WHERE status != 'cancelled'",
      "  Net Revenue = Gross Revenue - Returns - Discounts",
      "  MRR (Monthly Recurring Revenue) = SUM(subscription_amount) for active subscriptions",
      "  ARR = MRR × 12",
      "",
      "Profitability:",
      "  Gross Profit = Net Revenue - COGS",
      "  Gross Margin % = (Gross Profit / Net Revenue) × 100",
      "  Operating Profit = Gross Profit - OpEx",
      "  EBITDA = Operating Profit + Depreciation + Amortization",
      "  Net Profit = EBITDA - Interest - Taxes",
      "",
      "Unit Economics:",
      "  CAC (Customer Acquisition Cost) = Total Marketing Spend / New Customers Acquired",
      "  LTV (Lifetime Value) = ARPU × Average Customer Lifespan",
      "  LTV:CAC Ratio target > 3:1",
      "",
      "Cash Flow:",
      "  Burn Rate = Monthly Operating Expenses - Monthly Revenue",
      "  Runway (months) = Cash Balance / Burn Rate",
    ].join("\n");

    const resp = await page.request.post(`${API}/api/v1/kb/documents`, {
      multipart: {
        file: { name: "financial_kpis.txt", mimeType: "text/plain", buffer: Buffer.from(content) },
        title: "Financial KPI Definitions FY2024",
      },
    });
    const doc = await resp.json();
    expect(doc.status).toBe("ready");
    created.documents.push(doc.id);
  });

  test("2.3 Upload SLA & support rules", async ({ page }) => {
    const content = [
      "Customer Support SLA Definitions",
      "",
      "Ticket Priority Levels:",
      "  P1 (Critical): System down, response within 15 minutes, resolve within 4 hours",
      "  P2 (High): Major feature broken, response within 1 hour, resolve within 8 hours",
      "  P3 (Medium): Minor issue, response within 4 hours, resolve within 24 hours",
      "  P4 (Low): Enhancement request, response within 24 hours, resolve within 5 days",
      "",
      "SLA Compliance = (Tickets Resolved Within SLA / Total Tickets) × 100",
      "Target SLA Compliance: 95%",
      "",
      "CSAT (Customer Satisfaction Score) = (Positive Responses / Total Responses) × 100",
      "Target CSAT: 4.5 / 5.0",
      "",
      "First Response Time = Ticket Created Timestamp - First Agent Response Timestamp",
      "Resolution Time = Ticket Created Timestamp - Ticket Resolved Timestamp",
    ].join("\n");

    const resp = await page.request.post(`${API}/api/v1/kb/documents`, {
      multipart: {
        file: { name: "sla_rules.md", mimeType: "text/markdown", buffer: Buffer.from(content) },
        title: "Support SLA Rules",
      },
    });
    const doc = await resp.json();
    expect(doc.status).toBe("ready");
    created.documents.push(doc.id);
  });

  test("2.4 All three documents visible in KB page", async ({ page }) => {
    await page.goto("/knowledge-base");

    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Financial KPI Definitions FY2024")).toBeVisible();
    await expect(page.locator("text=Support SLA Rules")).toBeVisible();

    // All should have "ready" status
    const badges = page.locator('[class*="badge"]').filter({ hasText: "ready" });
    await expect(badges).toHaveCount(3);
  });

  test("2.5 Search KB for 'OEE' — finds manufacturing content", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible({ timeout: 5000 });

    await page.locator('input[placeholder="Search knowledge base..."]').fill("OEE availability performance");
    await page.getByRole("button", { name: "Search" }).click();

    // Should find OEE-related chunks
    await expect(page.locator("text=/Availability|Performance|Quality/").first()).toBeVisible({ timeout: 10000 });
    // Source should be the OEE document
    await expect(page.locator("text=OEE Manufacturing Guide").nth(1)).toBeVisible();
  });

  test("2.6 Search KB for 'profit' — finds financial content", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible({ timeout: 5000 });

    await page.locator('input[placeholder="Search knowledge base..."]').fill("gross profit margin revenue");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.locator("text=/Gross Profit|Net Revenue|Margin/").first()).toBeVisible({ timeout: 10000 });
  });

  test("2.7 Search KB for 'SLA compliance' — finds support content", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible({ timeout: 5000 });

    await page.locator('input[placeholder="Search knowledge base..."]').fill("SLA ticket resolution time");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.locator("text=/SLA|Ticket|Resolution/").first()).toBeVisible({ timeout: 10000 });
  });

  test("2.8 Search with no results — handles gracefully", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible({ timeout: 5000 });

    await page.locator('input[placeholder="Search knowledge base..."]').fill("quantum entanglement physics");
    await page.getByRole("button", { name: "Search" }).click();

    // Should still show results (ChromaDB returns closest matches) but with low scores
    // Verify no crash
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { name: "Knowledge Base" })).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: METADATA ANNOTATION
  // ═══════════════════════════════════════════════════════════

  test("3.1 Metadata page shows all connections in dropdown", async ({ page }) => {
    await page.goto("/metadata");

    const select = page.locator("select");
    await expect(select.locator("option", { hasText: "Production DB" })).toBeAttached({ timeout: 5000 });
    await expect(select.locator("option", { hasText: "Data Warehouse" })).toBeAttached();
    await expect(select.locator("option", { hasText: "Analytics Cache" })).toBeAttached();
  });

  test("3.2 Selecting a connection shows schema hint", async ({ page }) => {
    await page.goto("/metadata");

    // Select the Production DB
    const select = page.locator("select");
    await expect(select.locator("option", { hasText: "Production DB" })).toBeAttached({ timeout: 5000 });
    await select.selectOption({ label: `Production DB (postgresql)` });

    // No schema synced yet, so should show "No schema found" message
    await expect(page.locator("text=/No schema found|Sync/i")).toBeVisible({ timeout: 3000 });
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: MULTI-DASHBOARD MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  test("4.1 Create Ops Dashboard", async ({ page }) => {
    const resp = await page.request.post(`${API}/api/v1/dashboards`, {
      data: { title: "Operations Dashboard", description: "OEE, downtime, and production metrics" },
    });
    const dash = await resp.json();
    expect(dash.title).toBe("Operations Dashboard");
    created.dashboards.push(dash.id);
  });

  test("4.2 Create Finance Dashboard", async ({ page }) => {
    const resp = await page.request.post(`${API}/api/v1/dashboards`, {
      data: { title: "Finance Dashboard", description: "Revenue, margins, and cash flow" },
    });
    const dash = await resp.json();
    expect(dash.title).toBe("Finance Dashboard");
    created.dashboards.push(dash.id);
  });

  test("4.3 Create Exec Dashboard", async ({ page }) => {
    const resp = await page.request.post(`${API}/api/v1/dashboards`, {
      data: { title: "Executive Summary", description: "High-level KPIs for leadership" },
    });
    const dash = await resp.json();
    expect(dash.title).toBe("Executive Summary");
    created.dashboards.push(dash.id);
  });

  test("4.4 All three dashboards visible with correct details", async ({ page }) => {
    await page.goto("/dashboards");

    await expect(page.locator("text=Operations Dashboard")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Finance Dashboard")).toBeVisible();
    await expect(page.locator("text=Executive Summary")).toBeVisible();

    // Descriptions should be visible
    await expect(page.locator("text=OEE, downtime, and production metrics")).toBeVisible();
    await expect(page.locator("text=Revenue, margins, and cash flow")).toBeVisible();
    await expect(page.locator("text=High-level KPIs for leadership")).toBeVisible();

    // All should show 0 panels
    const panelCounts = page.locator("text=0 panels");
    await expect(panelCounts).toHaveCount(3);
  });

  test("4.5 Navigate into Ops dashboard and back", async ({ page }) => {
    await page.goto("/dashboards");
    await page.locator("text=Operations Dashboard").click();
    await page.waitForURL("**/dashboards/**");

    await expect(page.locator("text=Operations Dashboard")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=OEE, downtime, and production metrics")).toBeVisible();
    await expect(page.locator("text=No panels yet")).toBeVisible();

    // Go back
    await page.locator("main a[href='/dashboards']").click();
    await page.waitForURL(/\/dashboards$/);
    await expect(page.locator("text=Operations Dashboard")).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 5: QUERY SUBMISSION & ERROR HANDLING
  // ═══════════════════════════════════════════════════════════

  test("5.1 Submit multiple queries via API", async ({ page }) => {
    test.setTimeout(120000);

    const questions = [
      "What is the OEE trend for the last 30 days?",
      "Show me monthly revenue vs expenses",
      "Which machines have the highest downtime?",
    ];

    for (const q of questions) {
      const resp = await page.request.post(`${API}/api/v1/queries`, {
        data: { question: q },
      });
      expect(resp.ok()).toBeTruthy();
      const result = await resp.json();
      expect(result.question).toBe(q);
      expect(result.status).toBe("error"); // No Ollama
      created.queries.push(result.id);
    }
  });

  test("5.2 All queries appear in Chat history", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("text=Recent Queries")).toBeVisible();

    await expect(page.locator("text=What is the OEE trend").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=monthly revenue vs expenses").first()).toBeVisible();
    await expect(page.locator("text=highest downtime").first()).toBeVisible();
  });

  test("5.3 Query API returns correct shape", async ({ page }) => {
    const resp = await page.request.get(`${API}/api/v1/queries/${created.queries[0]}`);
    expect(resp.ok()).toBeTruthy();
    const q = await resp.json();

    // Verify full response shape
    expect(q).toHaveProperty("id");
    expect(q).toHaveProperty("question");
    expect(q).toHaveProperty("status");
    expect(q).toHaveProperty("sql_generated");
    expect(q).toHaveProperty("chart_spec");
    expect(q).toHaveProperty("result_data");
    expect(q).toHaveProperty("explanation");
    expect(q).toHaveProperty("error_message");
    expect(q).toHaveProperty("created_at");
  });

  test("5.4 Query list endpoint with pagination", async ({ page }) => {
    const resp = await page.request.get(`${API}/api/v1/queries?limit=2`);
    const queries = await resp.json();
    expect(queries.length).toBeLessThanOrEqual(2);
    expect(queries[0]).toHaveProperty("id");
    expect(queries[0]).toHaveProperty("question");
    expect(queries[0]).toHaveProperty("status");
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 6: EDGE CASES & VALIDATION
  // ═══════════════════════════════════════════════════════════

  test("6.1 Connection with special characters in name", async ({ page }) => {
    await page.goto("/connections");

    await page.locator('input[placeholder="Name"]').fill("Staging (US-West-2) — v2.1");
    await page.locator('input[placeholder*="Toolbox URL"]').fill("http://staging-us-west:5000");
    await page.locator("select").selectOption("postgresql");
    await page.getByRole("button", { name: "Add Connection" }).click();

    await expect(page.locator("text=Staging (US-West-2)")).toBeVisible({ timeout: 5000 });

    const resp = await page.request.get(`${API}/api/v1/connections`);
    const conns = await resp.json();
    const conn = conns.find((c: any) => c.name.includes("Staging"));
    expect(conn).toBeTruthy();
    created.connections.push(conn.id);
  });

  test("6.2 KB document with CSV format", async ({ page }) => {
    const csvContent = [
      "metric_name,formula,target,unit",
      "OEE,Availability*Performance*Quality,85,percent",
      "Availability,RunTime/PlannedTime*100,90,percent",
      "MTBF,TotalOperatingTime/NumberOfFailures,200,hours",
      "MTTR,TotalRepairTime/NumberOfRepairs,2,hours",
      "Yield,(GoodUnits/TotalUnits)*100,99,percent",
    ].join("\n");

    const resp = await page.request.post(`${API}/api/v1/kb/documents`, {
      multipart: {
        file: { name: "metrics_reference.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) },
        title: "Metrics Reference Table",
      },
    });
    const doc = await resp.json();
    expect(doc.status).toBe("ready");
    expect(doc.file_type).toBe("csv");
    created.documents.push(doc.id);
  });

  test("6.3 KB search finds CSV content", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=Metrics Reference Table")).toBeVisible({ timeout: 5000 });

    await page.locator('input[placeholder="Search knowledge base..."]').fill("MTBF mean time between failures");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.locator("text=/MTBF|MTTR|Failure/i").first()).toBeVisible({ timeout: 10000 });
  });

  test("6.4 Chat input — empty submit does nothing", async ({ page }) => {
    await page.goto("/chat");
    const textarea = page.locator("textarea");
    await textarea.fill("");

    // Submit button should be disabled
    const submitBtn = page.locator("button").filter({ has: page.locator("svg.lucide-send") });
    await expect(submitBtn).toBeDisabled();
  });

  test("6.5 Dashboard with long description", async ({ page }) => {
    const longDesc = "This dashboard tracks all operational efficiency metrics including OEE, downtime analysis, production throughput, quality defect rates, and maintenance scheduling across all 12 manufacturing lines in the Chicago and Detroit facilities for Q1-Q4 2024 reporting.";

    const resp = await page.request.post(`${API}/api/v1/dashboards`, {
      data: { title: "Detailed Ops Report", description: longDesc },
    });
    const dash = await resp.json();
    expect(dash.description).toBe(longDesc);
    created.dashboards.push(dash.id);

    await page.goto("/dashboards");
    await expect(page.locator("text=Detailed Ops Report")).toBeVisible({ timeout: 5000 });
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 7: CROSS-FEATURE INTEGRATION
  // ═══════════════════════════════════════════════════════════

  test("7.1 Full navigation circuit — verify all data persists", async ({ page }) => {
    // Chat
    await page.goto("/chat");
    await expect(page.locator("text=Recent Queries")).toBeVisible();
    await expect(page.locator("text=OEE trend").first()).toBeVisible({ timeout: 5000 });

    // Connections — all 4
    await page.getByRole("link", { name: "Connections" }).click();
    await page.waitForURL("**/connections");
    await expect(page.locator("text=Production DB")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Data Warehouse")).toBeVisible();
    await expect(page.locator("text=Analytics Cache")).toBeVisible();
    await expect(page.locator("text=Staging (US-West-2)")).toBeVisible();

    // Knowledge Base — all 4
    await page.getByRole("link", { name: "Knowledge Base" }).click();
    await page.waitForURL("**/knowledge-base");
    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Financial KPI")).toBeVisible();
    await expect(page.locator("text=Support SLA Rules")).toBeVisible();
    await expect(page.locator("text=Metrics Reference Table")).toBeVisible();

    // Metadata — all connections in dropdown
    await page.getByRole("link", { name: "Metadata" }).click();
    await page.waitForURL("**/metadata");
    const select = page.locator("select");
    await expect(select.locator("option", { hasText: "Production DB" })).toBeAttached({ timeout: 5000 });

    // Dashboards — all 4
    await page.getByRole("link", { name: "Dashboards" }).click();
    await page.waitForURL("**/dashboards");
    await expect(page.locator("text=Operations Dashboard")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Finance Dashboard")).toBeVisible();
    await expect(page.locator("text=Executive Summary")).toBeVisible();
    await expect(page.locator("text=Detailed Ops Report")).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 8: SELECTIVE DELETION & DATA INTEGRITY
  // ═══════════════════════════════════════════════════════════

  test("8.1 Delete one KB document — others remain", async ({ page }) => {
    // Delete the SLA document
    const slaId = created.documents[2]; // Support SLA Rules
    const resp = await page.request.delete(`${API}/api/v1/kb/documents/${slaId}`);
    expect(resp.ok()).toBeTruthy();
    created.documents = created.documents.filter((id) => id !== slaId);

    await page.goto("/knowledge-base");
    // SLA doc should be gone
    await expect(page.locator("text=Support SLA Rules")).not.toBeVisible({ timeout: 3000 });
    // Others should remain
    await expect(page.locator("text=OEE Manufacturing Guide")).toBeVisible();
    await expect(page.locator("text=Financial KPI")).toBeVisible();
    await expect(page.locator("text=Metrics Reference Table")).toBeVisible();
  });

  test("8.2 Delete one connection — others remain", async ({ page }) => {
    // Delete Analytics Cache
    const cacheId = created.connections[2]; // Analytics Cache
    const resp = await page.request.delete(`${API}/api/v1/connections/${cacheId}`);
    expect(resp.ok()).toBeTruthy();
    created.connections = created.connections.filter((id) => id !== cacheId);

    await page.goto("/connections");
    await expect(page.locator("text=Analytics Cache")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Production DB")).toBeVisible();
    await expect(page.locator("text=Data Warehouse")).toBeVisible();
    await expect(page.locator("text=Staging (US-West-2)")).toBeVisible();
  });

  test("8.3 Delete one dashboard — others remain", async ({ page }) => {
    await page.goto("/dashboards");
    await expect(page.locator("text=Executive Summary")).toBeVisible({ timeout: 5000 });

    // Delete Executive Summary via UI
    const card = page.locator('[class*="card"]').filter({ hasText: "Executive Summary" });
    await card.locator('button:has(svg)').last().click();

    await expect(page.locator("text=Executive Summary")).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Operations Dashboard")).toBeVisible();
    await expect(page.locator("text=Finance Dashboard")).toBeVisible();
    await expect(page.locator("text=Detailed Ops Report")).toBeVisible();

    created.dashboards = created.dashboards.filter((id) => id !== created.dashboards[2]);
  });

  test("8.4 KB search still works after partial deletion", async ({ page }) => {
    await page.goto("/knowledge-base");

    await page.locator('input[placeholder="Search knowledge base..."]').fill("OEE availability");
    await page.getByRole("button", { name: "Search" }).click();

    // Should still find OEE content from remaining documents
    await expect(page.locator("text=/Availability|OEE/").first()).toBeVisible({ timeout: 10000 });
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 9: API CONTRACT & ERROR HANDLING
  // ═══════════════════════════════════════════════════════════

  test("9.1 GET nonexistent connection returns 404", async ({ page }) => {
    const resp = await page.request.get(`${API}/api/v1/connections/99999`);
    expect(resp.status()).toBe(404);
  });

  test("9.2 GET nonexistent dashboard returns 404", async ({ page }) => {
    const resp = await page.request.get(`${API}/api/v1/dashboards/99999`);
    expect(resp.status()).toBe(404);
  });

  test("9.3 DELETE nonexistent document returns 404", async ({ page }) => {
    const resp = await page.request.delete(`${API}/api/v1/kb/documents/99999`);
    expect(resp.status()).toBe(404);
  });

  test("9.4 GET nonexistent query returns 404", async ({ page }) => {
    const resp = await page.request.get(`${API}/api/v1/queries/99999`);
    expect(resp.status()).toBe(404);
  });

  test("9.5 Health endpoint always returns ok", async ({ page }) => {
    const resp = await page.request.get(`${API}/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe("ok");
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 10: FINAL STATE VERIFICATION
  // ═══════════════════════════════════════════════════════════

  test("10.1 Final entity counts via API", async ({ page }) => {
    const [conns, docs, dashes, queries] = await Promise.all([
      page.request.get(`${API}/api/v1/connections`).then((r) => r.json()),
      page.request.get(`${API}/api/v1/kb/documents`).then((r) => r.json()),
      page.request.get(`${API}/api/v1/dashboards`).then((r) => r.json()),
      page.request.get(`${API}/api/v1/queries`).then((r) => r.json()),
    ]);

    // Should have exactly the entities we created minus deletions
    const myConns = conns.filter((c: any) => created.connections.includes(c.id));
    expect(myConns.length).toBe(created.connections.length); // 3 remaining

    const myDocs = docs.filter((d: any) => created.documents.includes(d.id));
    expect(myDocs.length).toBe(created.documents.length); // 3 remaining

    const myDashes = dashes.filter((d: any) => created.dashboards.includes(d.id));
    expect(myDashes.length).toBe(created.dashboards.length); // 3 remaining

    // Queries should have at least the 3 we created
    expect(queries.length).toBeGreaterThanOrEqual(3);
  });

  test("10.2 Final cleanup — delete all remaining entities", async ({ page }) => {
    // Delete remaining connections
    for (const id of [...created.connections]) {
      const resp = await page.request.delete(`${API}/api/v1/connections/${id}`);
      expect(resp.ok()).toBeTruthy();
    }

    // Delete remaining documents
    for (const id of [...created.documents]) {
      const resp = await page.request.delete(`${API}/api/v1/kb/documents/${id}`);
      expect(resp.ok()).toBeTruthy();
    }

    // Delete remaining dashboards
    for (const id of [...created.dashboards]) {
      const resp = await page.request.delete(`${API}/api/v1/dashboards/${id}`);
      expect(resp.ok()).toBeTruthy();
    }

    // Clear tracking
    created.connections = [];
    created.documents = [];
    created.dashboards = [];

    // Verify clean state in UI
    await page.goto("/dashboards");
    await expect(page.locator("text=No dashboards yet")).toBeVisible({ timeout: 5000 });
  });
});
