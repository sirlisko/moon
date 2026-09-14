import { test, expect } from "@playwright/test";

test("Year view: keyboard-select opens a detail view, back returns", async ({ page }) => {
  // Keyboard interaction rather than a pixel click — the grid is a WebGL
  // canvas with no per-cell DOM, so coordinates would be fragile; focusing
  // the canvas and pressing Enter deterministically selects the default
  // (today's) cell via the app's own accessibility support.
  await page.goto("/?view=year&year=2026");
  await page.locator("#bg").focus();
  await page.keyboard.press("Enter");

  await expect(page.locator(".back-button")).toBeVisible();
  await expect(page.locator(".moon-label")).toContainText("illuminated");

  await page.click(".back-button");
  await expect(page.locator('button[data-view="year"]')).toHaveClass(/active/);
});

test("Month view URL loads directly into that month", async ({ page }) => {
  await page.goto("/?view=month&year=2026&month=3");
  await expect(page.locator("#grid-label")).toHaveText("March 2026");
  await expect(page.locator('button[data-view="month"]')).toHaveClass(/active/);
});
