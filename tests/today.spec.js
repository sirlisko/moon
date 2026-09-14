import { test, expect } from "@playwright/test";

test("Today view loads live with a phase label and no errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await expect(page.locator(".moon-label")).toContainText("illuminated");
  await expect(page.locator('button[data-view="today"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});
