import { test, expect } from "@playwright/test";

const API = "http://localhost:8080";

test.describe("LLM Settings API", () => {
  test.afterAll(async ({ request }) => {
    // Reset to default Ollama config
    await request.put(`${API}/api/v1/settings/llm`, {
      data: { provider: "ollama", model: "llama3.2", api_key: "", base_url: "http://localhost:11434" },
    });
  });

  test("GET /settings/llm returns default config", async ({ request }) => {
    const resp = await request.get(`${API}/api/v1/settings/llm`);
    expect(resp.ok()).toBeTruthy();
    const config = await resp.json();
    expect(config).toHaveProperty("provider");
    expect(config).toHaveProperty("model");
    expect(config).toHaveProperty("api_key");
    expect(config).toHaveProperty("base_url");
  });

  test("PUT /settings/llm saves OpenAI config", async ({ request }) => {
    const resp = await request.put(`${API}/api/v1/settings/llm`, {
      data: {
        provider: "openai",
        model: "gpt-4o-mini",
        api_key: "sk-test-12345",
        base_url: "https://api.openai.com/v1",
      },
    });
    expect(resp.ok()).toBeTruthy();
    const saved = await resp.json();
    expect(saved.provider).toBe("openai");
    expect(saved.model).toBe("gpt-4o-mini");

    // Verify GET returns the new config
    const getResp = await request.get(`${API}/api/v1/settings/llm`);
    const config = await getResp.json();
    expect(config.provider).toBe("openai");
    expect(config.api_key).toBe("sk-test-12345");
  });

  test("PUT /settings/llm saves Anthropic config", async ({ request }) => {
    const resp = await request.put(`${API}/api/v1/settings/llm`, {
      data: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        api_key: "sk-ant-test",
        base_url: "",
      },
    });
    const saved = await resp.json();
    expect(saved.provider).toBe("anthropic");
    expect(saved.model).toBe("claude-sonnet-4-20250514");
  });

  test("POST /settings/llm/test validates Ollama connection", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/settings/llm/test`, {
      data: {
        provider: "ollama",
        model: "llama3.2",
        api_key: "",
        base_url: "http://localhost:11434",
      },
    });
    const result = await resp.json();
    // Ollama is running with llama3.2 on this machine
    expect(result.ok).toBe(true);
    expect(result.message).toContain("llama3.2");
  });

  test("POST /settings/llm/test rejects bad Ollama URL", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/settings/llm/test`, {
      data: {
        provider: "ollama",
        model: "llama3.2",
        api_key: "",
        base_url: "http://localhost:19999",
      },
    });
    const result = await resp.json();
    expect(result.ok).toBe(false);
  });

  test("POST /settings/llm/test rejects bad OpenAI key", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/settings/llm/test`, {
      data: {
        provider: "openai",
        model: "gpt-4o-mini",
        api_key: "sk-definitely-not-a-real-key",
        base_url: "https://api.openai.com/v1",
      },
    });
    const result = await resp.json();
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  test("POST /settings/llm/test rejects bad Anthropic key", async ({ request }) => {
    const resp = await request.post(`${API}/api/v1/settings/llm/test`, {
      data: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        api_key: "sk-ant-definitely-not-a-real-key",
        base_url: "",
      },
    });
    const result = await resp.json();
    expect(result.ok).toBe(false);
  });
});

test.describe("LLM Settings UI", () => {
  test.afterAll(async ({ request }) => {
    await request.put(`${API}/api/v1/settings/llm`, {
      data: { provider: "ollama", model: "llama3.2", api_key: "", base_url: "http://localhost:11434" },
    });
  });

  test("Settings modal shows all 3 providers", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Settings" }).click();
    await expect(page.getByText("LLM Provider", { exact: true })).toBeVisible({ timeout: 15000 });

    await expect(page.locator("text=Ollama").first()).toBeVisible();
    await expect(page.locator("text=OpenAI").first()).toBeVisible();
    await expect(page.locator("text=Anthropic Claude")).toBeVisible();
  });

  test("Switching provider shows appropriate fields", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Settings" }).click();
    await expect(page.getByText("LLM Provider", { exact: true })).toBeVisible({ timeout: 15000 });

    // Click OpenAI card — should show API Key field
    await page.locator("button", { hasText: "OpenAI" }).first().click();
    await expect(page.locator("text=API Key")).toBeVisible();
    await expect(page.locator('input[placeholder="sk-..."]')).toBeVisible();

    // Click Anthropic — should show API Key but NOT Base URL
    await page.locator("button", { hasText: "Anthropic Claude" }).click();
    await expect(page.locator("text=API Key")).toBeVisible();

    // Click Ollama — should show Base URL but NOT API Key
    await page.locator("button", { hasText: "Ollama" }).first().click();
    await expect(page.locator("text=Base URL")).toBeVisible();
    await expect(page.locator("text=API Key")).not.toBeVisible();
  });

  test("Test Connection button works", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.locator("header button", { hasText: "Settings" }).click();
    await expect(page.getByText("LLM Provider", { exact: true })).toBeVisible({ timeout: 15000 });

    // Make sure Ollama is selected
    await page.locator("button", { hasText: "Ollama" }).first().click();
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: "Test Connection" }).click();
    // Should show success (Ollama is running)
    await expect(page.locator("text=/Connected.*llama3/")).toBeVisible({ timeout: 10000 });
  });
});
