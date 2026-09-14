import { test, expect, devices } from "@playwright/test";

// Only the viewport/touch characteristics, not the full device preset —
// the preset also pins WebKit as the engine, which isn't installed here and
// isn't needed for this check (nav layout + no console errors, not
// Safari-specific behavior).
const iphone13 = devices["iPhone 13"];
test.use({
  viewport: iphone13.viewport,
  deviceScaleFactor: iphone13.deviceScaleFactor,
  isMobile: iphone13.isMobile,
  hasTouch: iphone13.hasTouch,
});

test("nav stays within the viewport and the app still works on a narrow phone", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/?view=month&year=2026&month=9");

  // Regression check for a real bug hit during development: the nav pill
  // rendering wider than the viewport and clipping off both edges.
  const box = await page.locator("#app-nav").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);

  await expect(page.locator("#grid-label")).toHaveText("September 2026");
  expect(errors).toEqual([]);
});
