import { test, expect } from "@playwright/test";

const API = "http://localhost:8080";

/**
 * E2E: Internal Toolbox Flow
 *
 * Tests the complete flow where:
 * 1. User enters database credentials (no external toolbox)
 * 2. Backend auto-creates internal MCP Toolbox
 * 3. All operations go through the Toolbox protocol
 * 4. Schema introspection, profiling, queries all work
 */
test.describe.serial("E2E: Internal Toolbox", () => {
  let connectionId: number;
  let kbDocId: number;

  test.afterAll(async ({ request }) => {
    if (kbDocId) await request.delete(`${API}/api/v1/kb/documents/${kbDocId}`).catch(() => {});
    if (connectionId) await request.delete(`${API}/api/v1/connections/${connectionId}`).catch(() => {});
  });

  // ── CONNECTION WITH CREDENTIALS ───────────────────────────

  test("1. Create connection with credentials — auto-creates internal toolbox", async ({ page, request }) => {
    // Create via API for reliability, then verify in UI
    const resp = await request.post(`${API}/api/v1/connections`, {
      data: {
        name: "Factory DB",
        source_type: "sqlite",
        file_path: "F:/Future Links/projects/DB Dashboard2/test-infra/test_factory.db",
      },
    });
    expect(resp.ok()).toBeTruthy();
    const conn = await resp.json();
    connectionId = conn.id;

    expect(conn.connection_type).toBe("toolbox");
    expect(conn.toolbox_url).toContain(`/toolbox/${connectionId}`);
    expect(conn.test_result?.ok).toBe(true);

    // Verify in UI
    await page.goto("/connections");
    await expect(page.locator("text=Factory DB")).toBeVisible({ timeout: 5000 });
  });

  test("2. Connection has auto-generated internal toolbox URL", async ({ request }) => {
    const resp = await request.get(`${API}/api/v1/connections/${connectionId}`);
    const conn = await resp.json();

    expect(conn.connection_type).toBe("toolbox");
    expect(conn.toolbox_url).toContain(`/toolbox/${connectionId}`);
    expect(conn.source_type).toBe("sqlite");
  });

  test("3. Internal toolbox endpoints are accessible", async ({ request }) => {
    // Toolset
    const toolsetResp = await request.get(`${API}/toolbox/${connectionId}/api/toolset`);
    expect(toolsetResp.ok()).toBeTruthy();
    const toolset = await toolsetResp.json();
    expect(toolset.serverVersion).toBe("internal-1.0");
    expect(toolset.tools).toHaveProperty("list_tables");
    expect(toolset.tools).toHaveProperty("execute_sql");

    // Health
    const healthResp = await request.get(`${API}/toolbox/${connectionId}/health`);
    expect(healthResp.ok()).toBeTruthy();
  });

  test("4. Execute SQL through internal toolbox", async ({ request }) => {
    const resp = await request.post(`${API}/toolbox/${connectionId}/api/tool/execute_sql/invoke`, {
      data: { params: { sql: "SELECT COUNT(*) as total FROM orders" } },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const result = JSON.parse(body.result);
    expect(result.columns).toEqual(["total"]);
    expect(result.rows[0][0]).toBeGreaterThan(1000);
  });

  test("5. List tables through internal toolbox", async ({ request }) => {
    const resp = await request.post(`${API}/toolbox/${connectionId}/api/tool/list_tables/invoke`, {
      data: { params: {} },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    const result = JSON.parse(body.result);
    const tableNames = result.tables.map((t: any) => t.name);
    expect(tableNames).toContain("machines");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("products");
    expect(tableNames).toContain("production_logs");
    expect(tableNames).toContain("monthly_expenses");
  });

  // ── SYNC SCHEMA (through toolbox) ─────────────────────────

  test("6. Sync schema — goes through ToolboxClient → internal toolbox", async ({ page }) => {
    await page.goto("/connections");
    await page.locator("text=Factory DB").click();

    // Click Sync Schema
    await page.getByRole("button", { name: "Sync Schema" }).click();

    // Wait for success
    await expect(page.locator("text=Schema synced")).toBeVisible({ timeout: 30000 });

    // Verify schema viewer shows tables
    await expect(page.locator("text=machines")).toBeVisible();
    await expect(page.locator("text=orders")).toBeVisible();
    await expect(page.locator("text=products")).toBeVisible();
  });

  test("7. Schema profile has correct row counts", async ({ request }) => {
    const resp = await request.get(`${API}/api/v1/connections/${connectionId}/schema`);
    const data = await resp.json();

    const profile = data.profile;
    expect(profile.tables.length).toBe(5);

    const orders = profile.tables.find((t: any) => t.name === "orders");
    expect(orders.row_count).toBeGreaterThan(1000);

    const machines = profile.tables.find((t: any) => t.name === "machines");
    expect(machines.row_count).toBe(6);
  });

  // ── KNOWLEDGE BASE ────────────────────────────────────────

  test("8. Upload KB document", async ({ request }) => {
    const content = "Revenue = SUM(total_amount) from orders WHERE status = completed";
    const resp = await request.post(`${API}/api/v1/kb/documents`, {
      multipart: {
        file: { name: "formulas.txt", mimeType: "text/plain", buffer: Buffer.from(content) },
        title: "Business Formulas",
      },
    });
    const doc = await resp.json();
    expect(doc.status).toBe("ready");
    kbDocId = doc.id;
  });

  // ── AGENTIC QUERIES VIA API (no LLM needed) ────────────────

  test("9. Meta query: 'Show all tables' — instant, no LLM", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/queries`, {
      data: { question: "Show me all tables" },
    });
    const result = await resp.json();
    expect(result.status).toBe("completed");
    expect(result.intent).toBe("meta_query");
    const tableNames = result.result_data.rows.map((r: any[]) => r[0]);
    expect(tableNames).toContain("machines");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("products");
  });

  test("10. Meta query: 'What databases are connected?'", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/queries`, {
      data: { question: "What databases are connected?" },
    });
    const result = await resp.json();
    expect(result.status).toBe("completed");
    expect(result.intent).toBe("meta_query");
    const names = result.result_data.rows.map((r: any[]) => r[0]);
    expect(names).toContain("Factory DB");
  });

  test("11. Meta query: 'How many rows in each table'", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/queries`, {
      data: { question: "How many rows are there in each table in the database?" },
    });
    const result = await resp.json();
    expect(result.status).toBe("completed");
    expect(result.intent).toBe("meta_query");
    expect(result.result_data.rows.length).toBeGreaterThanOrEqual(5);
  });

  test("12. Ambiguous query triggers clarification", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/queries`, {
      data: { question: "show me the data" },
    });
    const result = await resp.json();
    expect(result.status).toBe("clarification");
    expect(result.clarification.message).toBeTruthy();
    expect(result.clarification.options.length).toBeGreaterThan(0);
  });

  test("13. Clarification follow-up resolves to result", async ({ request }) => {
    // Get clarification
    const r1 = await (await request.post(`${API}/api/v1/queries`, {
      data: { question: "show me everything" },
    })).json();
    expect(r1.status).toBe("clarification");

    // Pick an option and re-submit
    const option = r1.clarification.options.find((o: any) => o.label.includes("Show all tables"));
    const r2 = await (await request.post(`${API}/api/v1/queries`, {
      data: { question: option.value },
    })).json();
    expect(r2.status).toBe("completed");
    expect(r2.intent).toBe("meta_query");
  });

  // ── CHAT THREADS ───────────────────────────────────────────

  test("14. Queries auto-create threads", async ({ request }) => {
    // Previous queries (tests 9-13) should have created threads
    const resp = await request.get(`${API}/api/v1/queries/threads`);
    const threads = await resp.json();
    expect(threads.length).toBeGreaterThan(0);

    // Each thread should have a title and message count
    const first = threads[0];
    expect(first.title).toBeTruthy();
    expect(first.message_count).toBeGreaterThan(0);
  });

  test("15. Continue conversation in same thread", async ({ request }) => {
    // Get first thread
    const threads = await (await request.get(`${API}/api/v1/queries/threads`)).json();
    const threadId = threads[0].id;
    const initialCount = threads[0].message_count;

    // Send a follow-up in the same thread
    const resp = await request.post(`${API}/api/v1/queries`, {
      data: { question: "List all tables", thread_id: threadId },
    });
    const result = await resp.json();
    expect(result.thread_id).toBe(threadId);

    // Thread should now have one more message
    const detail = await (await request.get(`${API}/api/v1/queries/threads/${threadId}`)).json();
    expect(detail.messages.length).toBe(initialCount + 1);
  });

  // ── TEST CONNECTION FROM UI ───────────────────────────────

  test("16-ui. Test connection button works", async ({ page }) => {
    await page.goto("/connections");
    await page.locator("text=Factory DB").click();

    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.locator("text=Connection successful")).toBeVisible({ timeout: 10000 });
  });

  // ── DASHBOARD CRUD ────────────────────────────────────────

  test("17. Create and view dashboard", async ({ page }) => {
    // Create via API
    const resp = await page.request.post(`${API}/api/v1/dashboards`, {
      data: { title: "Test Dashboard", description: "For testing" },
    });
    const dash = await resp.json();

    await page.goto("/dashboards");
    await expect(page.locator("text=Test Dashboard")).toBeVisible({ timeout: 5000 });

    // Clean up
    await page.request.delete(`${API}/api/v1/dashboards/${dash.id}`);
  });

  // ── CLEANUP ───────────────────────────────────────────────

  test("18. Delete connection removes toolbox engine", async ({ page }) => {
    await page.goto("/connections");
    await expect(page.locator("text=Factory DB")).toBeVisible({ timeout: 5000 });

    // Delete via API
    await page.request.delete(`${API}/api/v1/connections/${connectionId}`);
    connectionId = 0;

    // Internal toolbox should return 404
    const resp = await page.request.get(`${API}/toolbox/1/api/toolset`);
    expect(resp.status()).toBe(404);

    // Refresh page — connection gone
    await page.reload();
    await expect(page.locator("text=Factory DB")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=No connections yet")).toBeVisible();
  });
});
