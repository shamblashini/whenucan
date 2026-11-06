import { expect, test, type Browser, type Page } from "@playwright/test";

// Start each test with no test organiser, so repeated runs don't reach the daily group limit.
// These tests use their own server and data (see playwright.config.ts), not your local groups.
test.beforeEach(async ({ request }) => {
  await request.post("/api/auth/dev");
  await request.delete("/api/me");
});

async function createGroup(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in as a test organiser" }).click();
  return fillNewGroup(page, name);
}

async function fillNewGroup(page: Page, name: string): Promise<string> {
  await expect(page.getByRole("heading", { name: "New group" })).toBeVisible();
  await page.getByLabel("What are you planning?").fill(name);
  await page.getByLabel("Note for the group (optional)").fill("Pick whatever works");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: `${name} is ready` })).toBeVisible();
  return page.getByLabel("Share link").inputValue();
}

async function guest(browser: Browser, url: string, name: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, hasTouch: !!viewport });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByLabel("What's your name?").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Days", exact: true })).toBeVisible({ timeout: 20_000 });
  return page;
}

const openDays = (page: Page) => page.locator("button[data-day]:not(:disabled)");

test("a group, from creation to agreeing on a time", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const url = await createGroup(page, `Dinner ${Date.now()}`);
  expect(url).toMatch(/\/g\/[A-Za-z0-9]{12}$/);

  // A stranger with the link needs only a name.
  const anna = await guest(browser, url, "Anna");
  await expect(anna.getByText("1 person so far")).toBeVisible();

  // Mark days: tap to set, tap again to clear, change marker, drag across several.
  const days = openDays(anna);
  const first = days.nth(0);
  await first.click();
  await expect(first).toHaveAttribute("data-vote", "yes");
  await first.click();
  await expect(first).not.toHaveAttribute("data-vote");

  await anna.getByRole("radio", { name: "No" }).click();
  await days.nth(1).click();
  await expect(days.nth(1)).toHaveAttribute("data-vote", "no");

  await anna.getByRole("radio", { name: "OK" }).click();
  // Drag along one calendar row, in a single jump, as a fast mouse does.
  let row = 2;
  while ((await days.nth(row).boundingBox())!.y !== (await days.nth(row + 2).boundingBox())!.y) row++;
  const from = (await days.nth(row).boundingBox())!;
  const to = (await days.nth(row + 2).boundingBox())!;
  await anna.mouse.move(from.x + 10, from.y + 10);
  await anna.mouse.down();
  await anna.mouse.move(to.x + 10, to.y + 10);
  await anna.mouse.up();
  for (const i of [row, row + 1, row + 2]) await expect(days.nth(i)).toHaveAttribute("data-vote", "ok");

  // Answers survive a reload, and no name is asked for again.
  await anna.waitForTimeout(800);
  await anna.reload();
  await expect(openDays(anna).nth(row + 1)).toHaveAttribute("data-vote", "ok");

  // Proposal, seen live by someone else.
  const bob = await guest(browser, url, "Bob");
  await anna.getByRole("button", { name: "Propose a time" }).click();
  await anna.getByLabel("What's the plan? (optional)").fill("Pizza");
  await anna.getByRole("button", { name: "Add proposal" }).click();
  await expect(anna.getByText("Pizza")).toBeVisible();
  await expect(anna.getByRole("button", { name: "Remove proposal" })).toBeVisible();

  await expect(bob.getByText("Pizza")).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByRole("button", { name: "Remove proposal" })).toHaveCount(0);
  const answer = bob.getByRole("group", { name: "Your answer" });
  await answer.getByRole("button", { name: "OK" }).click();
  await expect(answer.getByRole("button", { name: "OK" })).toHaveAttribute("aria-pressed", "true");
  const annaRow = anna.locator("li", { hasText: "Pizza" });
  await expect(annaRow.locator("dd", { hasText: "Bob" })).toBeVisible({ timeout: 15_000 });

  // Everyone view: Bob sees who answered what.
  await bob.getByRole("tab", { name: "Everyone" }).click();
  await openDays(bob).nth(row).click();
  await expect(bob.getByText("Anna", { exact: true }).first()).toBeVisible();

  // Same name on another device means the same person, whatever the case.
  const annaAgain = await guest(browser, url, "ANNA");
  await expect(annaAgain.getByText("2 people so far")).toBeVisible();
  await expect(openDays(annaAgain).nth(row + 1)).toHaveAttribute("data-vote", "ok");

  expect(errors).toEqual([]);
});

test("the landing page offers your groups only once you have some", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in as a test organiser" }).click();
  await expect(page.getByRole("heading", { name: "New group" })).toBeVisible();

  // On a screen taller than the page, the footer sits at the bottom, and the columns keep their full width.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/");
  const footer = (await page.locator("footer").boundingBox())!;
  expect(footer.y + footer.height).toBeCloseTo(1400, 0);
  expect(footer.width).toBeGreaterThan(1100);
  await expect(page.getByRole("link", { name: "shamblashini/whenucan on GitHub" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  const create = page.getByRole("link", { name: "Create a group" });
  await expect(create).toBeVisible();
  await expect(page.getByRole("link", { name: "Your groups" })).toHaveCount(0);
  const text = (await page.getByText("Send your group one link").boundingBox())!;
  expect((await create.boundingBox())!.width).toBeCloseTo(text.width, 0);
  await expect(page.getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", /\/issues$/);
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("button", { name: "Delete my account" })).toBeVisible();

  // A reload must not look signed out while the account is still loading.
  await page.route("**/api/me", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "New group" })).toBeVisible();
  await page.unroute("**/api/me");

  await fillNewGroup(page, `Lunch ${Date.now()}`);
  await page.goto("/");
  const groups = page.getByRole("link", { name: "Your groups" });
  await expect(groups).toBeVisible();
  expect((await groups.boundingBox())!.y).toBe((await create.boundingBox())!.y);
  await expect(page.getByRole("link", { name: "Account" })).toHaveCount(0);
});

test("best days show who can make it", async ({ page, browser }) => {
  const url = await createGroup(page, `Picnic ${Date.now()}`);
  const anna = await guest(browser, url, "Anna");
  const annaFirst = openDays(anna).nth(1);
  await annaFirst.click();
  await expect(annaFirst).toHaveAttribute("data-vote", "yes");

  const bob = await guest(browser, url, "Bob");
  const bobFirst = openDays(bob).nth(1);
  await bob.getByRole("radio", { name: "No" }).click();
  await bobFirst.click();
  await expect(bobFirst).toHaveAttribute("data-vote", "no");

  const best = anna.locator(".best-day").first();
  await expect(best).toContainText("1 of 2 can make it", { timeout: 15_000 });
  await expect(best).toContainText("Can't: Bob");
  await best.click();
  await expect(anna.getByRole("tab", { name: "Everyone" })).toHaveAttribute("aria-selected", "true");
  await expect(anna.locator('button[data-day][data-selected="true"]')).toBeVisible();
});

test("a proposal can go to Google Calendar, with the clock format of the visitor", async ({ page, browser }) => {
  const url = await createGroup(page, `Dinner ${Date.now()}`);

  const context = await browser.newContext({ locale: "en-US", timezoneId: "Europe/Warsaw" });
  const warsaw = await context.newPage();
  await warsaw.goto(url);
  await warsaw.getByLabel("What's your name?").fill("Wanda");
  await warsaw.getByRole("button", { name: "Continue" }).click();
  await warsaw.getByRole("button", { name: "Propose a time" }).click();
  await warsaw.getByLabel("What's the plan? (optional)").fill("Pizza");
  await warsaw.getByLabel("From").fill("18:30");
  await warsaw.getByLabel("To", { exact: true }).fill("21:00");
  await warsaw.getByRole("button", { name: "Add proposal" }).click();
  const row = warsaw.locator("li", { hasText: "Pizza" });
  await expect(row).toContainText("18:30");
  await expect(row).toContainText("21:00");

  const link = row.getByRole("link", { name: "Add to Google Calendar" });
  const target = new URL((await link.getAttribute("href"))!);
  expect(target.searchParams.get("dates")).toMatch(/^\d{8}T183000\/\d{8}T210000$/);
  expect(target.searchParams.get("text")).toMatch(/^Pizza \(Dinner /);
  expect(target.searchParams.get("details")).toContain(url);

  const ics = await row.getByRole("link", { name: "Apple, Outlook and other calendars" }).getAttribute("href");
  const file = await warsaw.request.get(ics!);
  expect(file.headers()["content-type"]).toContain("text/calendar");
  expect(await file.text()).toMatch(/SUMMARY:Pizza \(Dinner /);

  const america = await (await browser.newContext({ locale: "en-US", timezoneId: "America/New_York" })).newPage();
  await america.goto(url);
  await america.getByLabel("What's your name?").fill("Amy");
  await america.getByRole("button", { name: "Continue" }).click();
  await expect(america.locator("li", { hasText: "Pizza" })).toContainText("6:30");
  await expect(america.locator("li", { hasText: "Pizza" })).toContainText("PM");
});

test("the page follows the browser's language, and the footer is small away from the landing page", async ({ browser }) => {
  const german = await (await browser.newContext({ locale: "de-DE" })).newPage();
  await german.goto("/");
  await expect(german.locator("html")).toHaveAttribute("lang", "de-DE");
  await expect(german.getByText("Send your group one link")).toHaveCount(0);

  // There is no Russian translation on purpose, so Russian browsers get Ukrainian.
  const russian = await (await browser.newContext({ locale: "ru-RU" })).newPage();
  await russian.goto("/");
  await expect(russian.locator("html")).toHaveAttribute("lang", "uk");
  await expect(russian.getByText("Надішли групі одне посилання")).toBeVisible();

  const page = await (await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 780 } })).newPage();
  await page.goto("/");
  await expect(page.getByText("Free and open source")).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByText("Free and open source")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Source code" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Report a problem" })).toBeVisible();
  const footer = page.locator("footer").getByRole("link", { name: "Privacy", exact: true });
  await expect(footer).toBeVisible();
  const logo = (await page.locator("footer svg").boundingBox())!;
  expect(logo.height).toBeLessThanOrEqual(16);
});

test("the organiser can remove people and replace the link", async ({ page, browser }) => {
  const url = await createGroup(page, `Trip ${Date.now()}`);
  const mallory = await guest(browser, url, "Mallory");

  await page.goto(url);
  await expect(page.getByLabel("What's your name?")).toHaveValue("Test");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Organise" }).click();

  const row = page.locator("li", { hasText: "Mallory" });
  await row.getByRole("button", { name: "Remove" }).click();
  await row.getByRole("button", { name: "Click again to remove" }).click();
  await expect(page.getByText("Mallory removed")).toBeVisible();

  await mallory.getByRole("radio", { name: "Yes" }).click();
  await expect(mallory.getByLabel("What's your name?")).toBeVisible({ timeout: 15_000 });
  await expect(mallory.getByRole("alert")).toContainText("removed");

  await page.getByRole("button", { name: "Replace link" }).click();
  await page.getByRole("button", { name: "Click again to replace" }).click();
  await expect(page).not.toHaveURL(url);
  await expect(page.getByRole("heading", { name: "Days", exact: true })).toBeVisible();

  await mallory.goto(url);
  await expect(mallory.getByRole("heading", { name: "This link does not work any more" })).toBeVisible();
});

test("scrolling on a touchscreen doesn't mark a day, and a tap does", async ({ browser }) => {
  const organiser = await browser.newPage();
  const url = await createGroup(organiser, `Touch ${Date.now()}`);
  const phone = await guest(browser, url, "Tess", { width: 390, height: 780 });
  const cell = openDays(phone).nth(1);
  await cell.tap();
  await expect(cell).toHaveAttribute("data-vote", "yes");

  // A real touch gesture: the browser pans the page and cancels the pointer, so nothing is marked.
  const target = openDays(phone).nth(3);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const client = await phone.context().newCDPSession(phone);
  const touch = (type: string, y?: number) =>
    client.send("Input.dispatchTouchEvent", {
      type: type as "touchStart",
      touchPoints: y === undefined ? [] : [{ x: box.x + 15, y }],
    });
  const startY = box.y + 15;
  await touch("touchStart", startY);
  for (let i = 1; i <= 6; i++) await touch("touchMove", startY - i * 25);
  await touch("touchEnd");
  await phone.waitForTimeout(300);
  await expect(target).not.toHaveAttribute("data-vote");

  const scrollWidth = await phone.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
