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
