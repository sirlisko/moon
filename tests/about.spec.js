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

test("Ko-fi link in About opens the tip page and tracks the click", async ({ page, context }) => {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (build) => window.__events.push(build({})) };
  });
  await context.route("https://ko-fi.com/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.goto("/");
  await page.click("#about-button");

  const popup = page.waitForEvent("popup");
  await page.click("#tip-link");
  expect((await popup).url()).toBe("https://ko-fi.com/sirlisko");
  const events = await page.evaluate(() => window.__events.map((e) => e.name));
  expect(events).toContain("tip-click");
});
