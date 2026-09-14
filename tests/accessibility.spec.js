import { test, expect } from "@playwright/test";

test("keyboard focus on the grid announces the focused day via the live region", async ({ page }) => {
  await page.goto("/?view=year&year=2026");
  const canvas = page.locator("#bg");
  await canvas.focus();

  await expect(page.locator(".sr-only")).toContainText("illuminated");
  const firstAnnouncement = await page.locator(".sr-only").textContent();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".sr-only")).not.toHaveText(firstAnnouncement);
  await expect(page.locator(".sr-only")).toContainText("illuminated");
});
