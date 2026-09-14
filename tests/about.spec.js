import { test, expect } from "@playwright/test";

test("About modal opens and closes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#about-overlay")).toBeHidden();

  await page.click("#about-button");
  await expect(page.locator("#about-overlay")).toBeVisible();
  await expect(page.locator("#about-card")).toContainText("Luca Lischetti");

  await page.click("#about-close");
  await expect(page.locator("#about-overlay")).toBeHidden();
});
