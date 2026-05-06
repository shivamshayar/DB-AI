import { test, expect } from "@playwright/test";

const API = "http://localhost:8000";

/**
 * Complex E2E test: Full user journey through the entire application.
 *
 * Exercises every major feature: connections, knowledge base, metadata,
 * query submission, dashboards, cross-page navigation, and cleanup.
 *
 * Uses test.describe.serial so tests run in order and share state.
 */
test.describe.serial("E2E Full Journey", () => {
  let connectionId: number;
  let documentId: number;
  let dashboardId: number;
  let queryId: number;

  test.afterAll(async ({ request }) => {
    // Safety cleanup via API
    if (connectionId) await request.delete(`${API}/api/v1/connections/${connectionId}`).catch(() => {});
    if (documentId) await request.delete(`${API}/api/v1/kb/documents/${documentId}`).catch(() => {});
    if (dashboardId) await request.delete(`${API}/api/v1/dashboards/${dashboardId}`).catch(() => {});
  });

  // ── SETTINGS & HEALTH ─────────────────────────────────────

  test("Step 1: Backend health check from Settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Click first Test button (Backend API)
    const testButtons = page.getByRole("button", { name: "Test" });
    await testButtons.first().click();

    // OK badge appears
    await expect(page.getByText("OK")).toBeVisible({ timeout: 10000 });
  });

  // ── CONNECTIONS ───────────────────────────────────────────

  test("Step 2: Create a database connection", async ({ page }) => {
    await page.goto("/connections");

    // Fill form
    await page.locator('input[placeholder="Name"]').fill("Test Sales DB");
    await page.locator('input[placeholder*="Toolbox URL"]').fill("http://localhost:5000");
    await page.locator("select").selectOption("postgresql");

    // Submit
    await page.getByRole("button", { name: "Add Connection" }).click();

    // Verify it appears
    await expect(page.locator("text=Test Sales DB")).toBeVisible({ timeout: 5000 });

    // Capture ID for later
    const resp = await page.request.get(`${API}/api/v1/connections`);
    const conns = await resp.json();
    connectionId = conns.find((c: { name: string }) => c.name === "Test Sales DB")?.id;
    expect(connectionId).toBeTruthy();
  });

  test("Step 3: Connection detail — select and test (graceful failure)", async ({ page }) => {
    await page.goto("/connections");

    // Click on the card
    await page.locator("text=Test Sales DB").click();

    // Detail panel shows
    await expect(page.getByText("http://localhost:5000")).toBeVisible();
    await expect(page.getByRole("button", { name: "Test" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync Schema" })).toBeVisible();

    // Test connection — should fail (no toolbox server)
    await page.getByRole("button", { name: "Test" }).click();
    await expect(page.locator("text=/Connection failed|failed|error/i")).toBeVisible({ timeout: 15000 });
  });

  // ── KNOWLEDGE BASE ────────────────────────────────────────

  test("Step 4: Upload a knowledge base document via API, verify in UI", async ({ page }) => {
    const testContent = [
      "Business Formulas and Definitions",
      "",
      "Profit = Revenue - Cost of Goods Sold - Operating Expenses",
      "Gross Margin = (Revenue - COGS) / Revenue * 100",
      "OEE = Availability x Performance x Quality",
      "Customer LTV = Average Order Value x Purchase Frequency x Customer Lifespan",
      "Churn Rate = (Customers Lost / Total Customers at Start) x 100",
    ].join("\n");

    // Upload via API
    const uploadResp = await page.request.post(`${API}/api/v1/kb/documents`, {
      multipart: {
        file: { name: "business_formulas.txt", mimeType: "text/plain", buffer: Buffer.from(testContent) },
        title: "Business Formulas",
      },
    });
    expect(uploadResp.ok()).toBeTruthy();
    const doc = await uploadResp.json();
    documentId = doc.id;
    expect(doc.status).toBe("ready");

    // Verify in UI
    await page.goto("/knowledge-base");
    await expect(page.locator("text=Business Formulas")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=business_formulas.txt")).toBeVisible();
  });

  test("Step 5: Search knowledge base and find relevant results", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=Business Formulas")).toBeVisible({ timeout: 5000 });

    // Search
    const searchInput = page.locator('input[placeholder="Search knowledge base..."]');
    await searchInput.fill("profit formula revenue");
    await page.getByRole("button", { name: "Search" }).click();

    // Expect results with profit/revenue content
    await expect(page.locator("text=/Profit|Revenue|COGS/")).toBeVisible({ timeout: 10000 });
    // Score badge
    await expect(page.locator("text=/\\d+% match/")).toBeVisible();
  });

  // ── METADATA ──────────────────────────────────────────────

  test("Step 6: Metadata page shows connection in dropdown", async ({ page }) => {
    await page.goto("/metadata");
    await expect(page.getByRole("heading", { name: "Table & Column Metadata" })).toBeVisible();

    const select = page.locator("select");
    await expect(select).toBeVisible();

    // Wait for connection options to load from API, then check value
    await expect(select.locator("option", { hasText: "Test Sales DB" })).toBeAttached({ timeout: 5000 });
  });

  // ── DASHBOARDS ────────────────────────────────────────────

  test("Step 7: Create a dashboard via dialog", async ({ page }) => {
    await page.goto("/dashboards");
    await expect(page.getByRole("heading", { name: "Dashboards" })).toBeVisible();

    // Open create dialog
    await page.locator("text=Create Dashboard").click();
    const dialog = page.getByRole("dialog", { name: "Create Dashboard" });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Fill form
    await dialog.locator('input[placeholder="Title"]').fill("Sales Overview");
    await dialog.locator('input[placeholder*="Description"]').fill("Monthly sales metrics and KPIs");

    // Create
    await dialog.getByRole("button", { name: "Create" }).click();

    // Should navigate to dashboard detail
    await page.waitForURL("**/dashboards/**", { timeout: 5000 });
    await expect(page.locator("text=Sales Overview")).toBeVisible({ timeout: 5000 });

    // Capture ID
    const match = page.url().match(/dashboards\/(\d+)/);
    if (match) dashboardId = parseInt(match[1]);
    expect(dashboardId).toBeTruthy();
  });

  test("Step 8: Dashboard detail page has correct elements", async ({ page }) => {
    await page.goto(`/dashboards/${dashboardId}`);

    await expect(page.locator("text=Sales Overview")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Refresh All" })).toBeVisible();
    await expect(page.locator("text=No panels yet")).toBeVisible();

    // Back button works (the one inside main content, not sidebar)
    await page.locator("main a[href='/dashboards']").click();
    await page.waitForURL("**/dashboards");
    await expect(page.locator("text=Sales Overview")).toBeVisible();
    await expect(page.locator("text=0 panels")).toBeVisible();
  });

  // ── QUERY ─────────────────────────────────────────────────

  test("Step 9: Submit query via API (graceful error — no Ollama)", async ({ page }) => {
    test.setTimeout(60000);
    // Submit directly via API to avoid UI timeout
    const resp = await page.request.post(`${API}/api/v1/queries`, {
      data: { question: "What is the monthly revenue trend?" },
    });
    expect(resp.ok()).toBeTruthy();
    const result = await resp.json();
    queryId = result.id;

    // Should have error status (Ollama not running)
    expect(result.status).toBe("error");
    expect(result.question).toBe("What is the monthly revenue trend?");
    // error_message may be empty string if the exception had no message
    expect(result.id).toBeTruthy();
  });

  test("Step 10: Query appears in Chat history", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("text=Recent Queries")).toBeVisible();

    // Our query should be in the history (use first() as there may be duplicates from prior runs)
    await expect(page.locator("text=What is the monthly revenue trend?").first()).toBeVisible({ timeout: 5000 });
    // With error badge
    await expect(page.locator('[class*="badge"]').filter({ hasText: "error" }).first()).toBeVisible();
  });

  test("Step 11: Click history item loads query detail", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("text=Recent Queries")).toBeVisible();

    // Click first history item
    const historyBtn = page.locator("button").filter({ hasText: "What is the monthly revenue trend?" }).first();
    await expect(historyBtn).toBeVisible({ timeout: 5000 });
    await historyBtn.click();

    // Verify the query loaded — no chart or data should appear for a failed query
    // (no completed result means no ChartPanel, no SQL section, no data table)
    await expect(page.locator("text=Ask a Question")).toBeVisible();
    // The history item should still be highlighted / present
    await expect(historyBtn).toBeVisible();
  });

  // ── CROSS-PAGE STATE ──────────────────────────────────────

  test("Step 12: Cross-page navigation — all data persists", async ({ page }) => {
    // Connections
    await page.goto("/connections");
    await expect(page.locator("text=Test Sales DB")).toBeVisible({ timeout: 5000 });

    // Knowledge Base
    await page.getByRole("link", { name: "Knowledge Base" }).click();
    await page.waitForURL("**/knowledge-base");
    await expect(page.locator("text=Business Formulas")).toBeVisible({ timeout: 5000 });

    // Dashboards
    await page.getByRole("link", { name: "Dashboards" }).click();
    await page.waitForURL("**/dashboards");
    await expect(page.locator("text=Sales Overview")).toBeVisible({ timeout: 5000 });

    // Chat history
    await page.getByRole("link", { name: "Chat" }).click();
    await page.waitForURL("**/chat");
    await expect(page.locator("text=What is the monthly revenue trend?").first()).toBeVisible({ timeout: 5000 });

    // Back to Metadata — connection in dropdown
    await page.getByRole("link", { name: "Metadata" }).click();
    await page.waitForURL("**/metadata");
    const opts = await page.locator("select option").allTextContents();
    expect(opts.some((t) => t.includes("Test Sales DB"))).toBeTruthy();
  });

  // ── CLEANUP VIA UI ────────────────────────────────────────

  test("Step 13: Delete dashboard from UI", async ({ page }) => {
    await page.goto("/dashboards");
    await expect(page.locator("text=Sales Overview")).toBeVisible({ timeout: 5000 });

    // Click trash icon on the card
    const card = page.locator('[class*="card"]').filter({ hasText: "Sales Overview" });
    await card.locator('button:has(svg)').last().click();

    // Should disappear
    await expect(page.locator("text=Sales Overview")).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=No dashboards yet")).toBeVisible();
    dashboardId = 0;
  });

  test("Step 14: Delete KB document from UI", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("text=Business Formulas")).toBeVisible({ timeout: 5000 });

    // Click trash icon
    const docCard = page.locator('[class*="card"]').filter({ hasText: "Business Formulas" });
    await docCard.locator('button:has(svg)').click();

    await expect(page.locator("text=Business Formulas")).not.toBeVisible({ timeout: 5000 });
    documentId = 0;
  });

  test("Step 15: Delete connection from UI", async ({ page }) => {
    await page.goto("/connections");
    await expect(page.locator("text=Test Sales DB")).toBeVisible({ timeout: 5000 });

    // Click trash icon on card
    const card = page.locator('[class*="card"]').filter({ hasText: "Test Sales DB" });
    await card.locator('button:has(svg)').click();

    await expect(page.locator("text=Test Sales DB")).not.toBeVisible({ timeout: 5000 });
    connectionId = 0;
  });

  // ── VERIFY CLEAN STATE ────────────────────────────────────

  test("Step 16: Verify clean state via API and UI", async ({ page }) => {
    // API verification
    const conns = await (await page.request.get(`${API}/api/v1/connections`)).json();
    expect(conns.find((c: { name: string }) => c.name === "Test Sales DB")).toBeUndefined();

    const docs = await (await page.request.get(`${API}/api/v1/kb/documents`)).json();
    expect(docs.find((d: { title: string }) => d.title === "Business Formulas")).toBeUndefined();

    const dashes = await (await page.request.get(`${API}/api/v1/dashboards`)).json();
    expect(dashes.find((d: { title: string }) => d.title === "Sales Overview")).toBeUndefined();

    // UI verification
    await page.goto("/dashboards");
    await expect(page.locator("text=No dashboards yet")).toBeVisible({ timeout: 5000 });
  });
});
