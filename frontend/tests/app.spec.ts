import { test, expect } from "@playwright/test";

test.describe("DB Dashboard - Smoke Tests", () => {
  test("home page redirects to /chat", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });

  test("chat page renders with welcome state and input", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("text=What would you like to know?")).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();
    await expect(page.getByRole("button", { name: "New Chat" })).toBeVisible();
  });

  test("sidebar has brand and thread list", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("text=DB Dashboard")).toBeVisible();
    await expect(page.getByRole("button", { name: "New Chat" })).toBeVisible();
  });

  test("top header has all menu icons", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(1000);
    for (const label of ["Connections", "Knowledge Base", "Metadata", "Dashboards", "Settings"]) {
      await expect(page.locator("header button", { hasText: label })).toBeVisible();
    }
  });

  test("clicking Connections opens modal", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Connections" }).click();
    await expect(page.locator("text=Database Connections")).toBeVisible({ timeout: 15000 });
  });

  test("clicking Knowledge Base opens modal", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Knowledge Base" }).click();
    await expect(page.locator("text=Drop files here or browse")).toBeVisible({ timeout: 15000 });
  });

  test("clicking Settings opens modal with LLM providers", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Settings" }).click();
    await expect(page.getByText("LLM Provider", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Ollama").first()).toBeVisible();
    await expect(page.locator("text=OpenAI").first()).toBeVisible();
    await expect(page.locator("text=Anthropic Claude")).toBeVisible();
  });

  test("modal closes with X button", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Connections" }).click();
    await expect(page.locator("text=Database Connections")).toBeVisible({ timeout: 15000 });

    // Close
    await page.locator('button:has(svg.lucide-x)').click();
    await expect(page.locator("text=What would you like to know?")).toBeVisible({ timeout: 5000 });
  });

  test("welcome state quick-start buttons visible", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("text=Show me all tables")).toBeVisible();
    await expect(page.locator("text=What databases are connected?")).toBeVisible();
  });
});
