import { expect, test, type Page } from "@playwright/test";

// The SSR HTML already carries the auth state (header CTA + support card);
// hydration must not change either afterwards. The probe installed through
// addInitScript counts, from document start through the load event:
// - text changes of the header CTA button (header [data-auth-cta]);
// - insertions and removals of the support card
//   ([data-auth-support-card], ServerFooter.tsx), so a card that flashes
//   in (and out) during the window is caught, not only its final state.

type AuthProbe = {
  ctaChanges: string[];
  ctaMutations: number;
  cardInsertions: number;
  cardRemovals: number;
};

function installAuthProbe(page: Page) {
  return page.context().addInitScript(() => {
    const state: AuthProbe = {
      ctaChanges: [],
      ctaMutations: 0,
      cardInsertions: 0,
      cardRemovals: 0,
    };
    (window as unknown as { __authProbe: AuthProbe }).__authProbe = state;
    let ctaBaseline: string | null = null;
    let cardPresent: boolean | null = null;
    const ctaText = () =>
      document.querySelector("header [data-auth-cta]")?.textContent ?? null;
    const hasCard = () =>
      document.querySelector("[data-auth-support-card]") !== null;
    const record = () => {
      const cta = ctaText();
      if (cta !== null) {
        if (ctaBaseline === null) {
          // First time the SSR CTA is readable: that is the baseline,
          // whatever later mutations the hydration performs.
          ctaBaseline = cta;
        } else if (cta !== ctaBaseline) {
          state.ctaMutations += 1;
          state.ctaChanges.push(`${ctaBaseline} -> ${cta}`);
          ctaBaseline = cta;
        }
      }
      const card = hasCard();
      if (cardPresent === null) cardPresent = card;
      else if (card !== cardPresent) {
        if (card) state.cardInsertions += 1;
        else state.cardRemovals += 1;
        cardPresent = card;
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document.documentElement, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

async function readAuthProbe(page: Page): Promise<AuthProbe> {
  return page.evaluate(
    () => (window as unknown as { __authProbe: AuthProbe }).__authProbe,
  );
}

test("hydration: the header CTA and the support card do not change after load", async ({ browser, page }) => {
  // Pro account from the seeded cloud e2e fixture (fresh state per run).
  const signIn = await page.request.post("/api/auth/email-codes/verify", {
    data: { code: "826826", email: "pro.cloud-local@pinar.test", returnTo: "/" },
  });
  expect(signIn.ok()).toBe(true);

  // The probe resets per document (fresh window per navigation), so it is
  // installed once for every goto in this context.
  await installAuthProbe(page);
  for (const path of ["/", "/pricing"]) {
    await page.goto(path);
    // The SSR CTA is the signed-in one; hydration must leave it untouched.
    await expect(page.locator("header [data-auth-cta='open-app']")).toBeVisible();
    // Give the (buggy) client-side session fetch time to land and swap the
    // CTA or flash the card: the counters must still be zero.
    await page.waitForTimeout(2_000);
    const probe = await readAuthProbe(page);
    expect(probe.ctaMutations, `CTA text changes on ${path}`).toBe(0);
    expect(probe.ctaChanges).toEqual([]);
    // Pro: the support card must be absent during the whole window —
    // no insertion and no removal of it — and still absent at the end.
    expect(probe.cardInsertions, `support card insertions on ${path}`).toBe(0);
    expect(probe.cardRemovals, `support card removals on ${path}`).toBe(0);
    await expect(page.locator("[data-auth-support-card]")).toHaveCount(0);
  }

  // Signed-out (fresh context, no session cookie): the SSR CTA is the
  // sign-in one and the support card is part of the SSR HTML; both must
  // stay untouched after the client revalidation, on / and /pricing.
  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await installAuthProbe(anonPage);
  for (const path of ["/", "/pricing"]) {
    await anonPage.goto(path);
    await expect(anonPage.locator("header [data-auth-cta='sign-in']")).toBeVisible();
    await anonPage.waitForTimeout(2_000);
    const anonProbe = await readAuthProbe(anonPage);
    expect(anonProbe.ctaMutations, `CTA text changes on ${path}`).toBe(0);
    expect(anonProbe.ctaChanges).toEqual([]);
    // Signed-out: the support card is present in the SSR HTML and must
    // neither be removed (flash out) nor re-inserted during the window.
    expect(anonProbe.cardInsertions, `support card insertions on ${path}`).toBe(0);
    expect(anonProbe.cardRemovals, `support card removals on ${path}`).toBe(0);
    await expect(anonPage.locator("[data-auth-support-card]")).toHaveCount(1);
  }
  await anonymous.close();
});
