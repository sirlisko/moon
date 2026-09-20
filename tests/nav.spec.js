import { test, expect } from "@playwright/test";

test("day-stepping from Today enters a detail view and back returns to live", async ({ page }) => {
  await page.goto("/");
  const firstLabel = await page.locator(".moon-label").textContent();

  await page.click("#grid-next");
  await expect(page.locator(".back-button")).toBeVisible();
  const nextLabel = await page.locator(".moon-label").textContent();
  expect(nextLabel).not.toBe(firstLabel);

  await page.click(".back-button");
  await expect(page.locator('button[data-view="today"]')).toHaveClass(/active/);
  await expect(page.locator(".back-button")).toHaveCount(0);
});

test("the URL reflects navigation and restores on a fresh load", async ({ page, context }) => {
  await page.goto("/");
  await page.click('button[data-view="year"]');
  await page.click("#grid-prev");
  await expect(page).toHaveURL(/view=year&year=2025/);

  const page2 = await context.newPage();
  await page2.goto(page.url());
  await expect(page2.locator("#grid-label")).toHaveText("2025");
  await expect(page2.locator('button[data-view="year"]')).toHaveClass(/active/);
});

test("stepping days inside a detail view moves where back goes", async ({ page }) => {
  await page.goto("/?view=month&year=2026&month=8");
  await page.locator("#bg").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".back-button")).toHaveText("← Back to August 2026");

  // Far enough forward to land in the next month.
  for (let i = 0; i < 40; i++) await page.click("#grid-next");
  await expect(page.locator("#grid-label")).toContainText("Sep");
  await expect(page.locator(".back-button")).toHaveText("← Back to September 2026");

  await page.click(".back-button");
  await expect(page.locator("#grid-label")).toHaveText("September 2026");
});
