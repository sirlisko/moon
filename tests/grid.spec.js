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

test("Print button opens an email signup and tracks interest without the address", async ({ page }) => {
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (build) => window.__events.push(build({})) };
  });
  let submitted = null;
  await page.route("/", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submitted = new URLSearchParams(route.request().postData());
    return route.fulfill({ status: 200, body: "" });
  });

  await page.goto("/?view=year&year=2026");
  await page.click("#print-button");
  await expect(page.locator("#print-dialog")).toBeVisible();
  await page.fill("#print-email", "reader@example.com");
  await page.click('#print-form button[type="submit"]');
  await expect(page.locator("#print-status")).toHaveText("Thanks, you're on the list.");

  expect(submitted.get("form-name")).toBe("print-interest");
  expect(submitted.get("email")).toBe("reader@example.com");
  expect(submitted.get("year")).toBe("2026");
  const events = await page.evaluate(() => window.__events.filter((e) => e.name?.startsWith("print-")));
  expect(events.map((e) => e.name)).toEqual(["print-interest", "print-signup"]);
  expect(JSON.stringify(events)).not.toContain("reader@example.com");

  await page.keyboard.press("Escape");
  await expect(page.locator("#print-dialog")).toBeHidden();
  await page.click('button[data-view="today"]');
  await expect(page.locator("#print-button")).toBeHidden();
});
