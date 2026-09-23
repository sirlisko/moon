import { test, expect } from "@playwright/test";

test("the time slider changes the shown time and round-trips through the URL", async ({ page, context }) => {
  await page.goto("/?view=detail&date=2026-09-20");
  const slider = page.locator(".time-control input");
  await expect(slider).toHaveValue(String(21 * 60));

  await slider.fill(String(6 * 60 + 30));
  await expect(page).toHaveURL(/time=06:30/);

  const page2 = await context.newPage();
  await page2.goto(page.url());
  await expect(page2.locator(".time-control input")).toHaveValue(String(6 * 60 + 30));
});

test("the info panel counts down to the next new or full moon", async ({ page }) => {
  await page.goto("/?view=detail&date=2026-09-20");
  await expect(page.locator(".moon-label")).toContainText(/(full|new) moon (in \d+ days?|at)/i);
});

test("arrow keys step a day, except while the time slider has focus", async ({ page }) => {
  await page.goto("/?view=detail&date=2026-09-20");
  await expect(page.locator("#grid-label")).toContainText("20");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#grid-label")).toContainText("21");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#grid-label")).toContainText("19");

  await page.locator(".time-control input").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#grid-label")).toContainText("19");
});

test("a location granted on an earlier visit is used without asking again", async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 51.5, longitude: -0.13 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".moon-label")).toContainText(/horizon/);
  await expect(page.locator(".location-button:not(.sky-compass-button)")).toBeHidden();
  await context.close();
});
