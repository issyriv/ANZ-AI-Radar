// Headless browser layer (Playwright/Chromium).
//
// Many VC portfolio pages are client-rendered: a plain fetch returns an empty
// shell, a client-routed 404, or a bot-check 429. This module renders those
// pages properly. It is deliberately lazy — the browser only launches if a
// source actually needs it, so pure-HTTP runs pay nothing.
//
// One shared browser process, one context per render (cheap), bounded
// concurrency, and a hard per-page timeout so a hanging site cannot stall a run.

import type { Browser, BrowserContext } from "playwright";

const NAV_TIMEOUT = Number(process.env.BROWSER_NAV_TIMEOUT ?? 45_000);
const SETTLE_MS = Number(process.env.BROWSER_SETTLE_MS ?? 2_500);
const MAX_SCROLLS = Number(process.env.BROWSER_MAX_SCROLLS ?? 12);
const LOAD_MORE_CLICKS = Number(process.env.BROWSER_LOAD_MORE_CLICKS ?? 25);
// Hard wall-clock ceiling for one render. Infinite-scroll grids will otherwise
// keep the scroll loop alive for many minutes (firstminute.capital took 8m in
// testing); a bounded partial page beats stalling the whole crawl.
const RENDER_DEADLINE = Number(process.env.BROWSER_DEADLINE ?? 90_000);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let _browser: Browser | null = null;
let _launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  // Only reuse an in-flight launch, never a settled one.
  //
  // The previous version cached `_launching` forever. Once Chromium died — crash,
  // OOM, or our own closeBrowser() — isConnected() correctly returned false and
  // then this function handed back the settled promise still pointing at the dead
  // instance, so the relaunch path could never run. Every subsequent source failed
  // with "browser.newContext: Target page, context or browser has been closed",
  // permanently. That one line killed 7 portfolio sources in a single run.
  if (_launching) return _launching;
  _launching = (async () => {
    const { chromium } = await import("playwright");
    console.log("[browser] launching chromium");
    _browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    // If the browser dies later, drop our handle so the next call relaunches.
    _browser.once("disconnected", () => {
      console.warn("[browser] chromium disconnected — will relaunch on next use");
      _browser = null;
      _launching = null;
    });
    return _browser;
  })();
  try {
    return await _launching;
  } catch (e) {
    _browser = null;
    throw e;
  } finally {
    // Settled either way: never hand this promise out again.
    _launching = null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    _launching = null;
    console.log("[browser] closed");
  }
}

/**
 * Consent-banner accept buttons, most common platforms first.
 *
 * These matter more than they look. A OneTrust overlay does not just cover the
 * page, it blocks the grid from rendering underneath — LocalGlobe and Latitude
 * both returned ~8KB of pure cookie-policy text and zero companies until this
 * ran, and they looked like successful fetches the whole time.
 */
const CONSENT_TIMEOUT = Number(process.env.BROWSER_CONSENT_TIMEOUT ?? 8_000);

const CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAcceptAll",
  "#CybotCookiebotBannerCloseButtonE2E",
  "#CybotCookiebotDialogBodyButtonAccept",
  "button#hs-eu-confirmation-button",
  ".cc-allow",
  ".cky-btn-accept",
  "[data-testid='uc-accept-all-button']",
  "button[aria-label*='Accept all' i]",
  "button[title*='Accept all' i]",
];

/** Text used by bespoke banners that expose no stable selector. */
const CONSENT_TEXT = ["Accept all", "Accept All Cookies", "Allow all", "I agree", "Got it"];

async function dismissConsent(page: import("playwright").Page): Promise<boolean> {
  // Poll rather than check once. Cookiebot and OneTrust inject their dialog
  // asynchronously, often after networkidle, so a single check right after load
  // reliably misses it — which is how localglobe.vc kept returning 8KB of cookie
  // policy and zero companies even with the correct selector already listed.
  const deadline = Date.now() + CONSENT_TIMEOUT;
  while (Date.now() < deadline) {
    for (const sel of CONSENT_SELECTORS) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3_000, force: true }).catch(() => {});
        await page.waitForTimeout(800);
        console.log(`[browser] dismissed consent banner via ${sel}`);
        return true;
      }
    }
    for (const text of CONSENT_TEXT) {
      const btn = page.getByRole("button", { name: new RegExp(`^\\s*${text}\\s*$`, "i") }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3_000, force: true }).catch(() => {});
        await page.waitForTimeout(800);
        console.log(`[browser] dismissed consent banner via text "${text}"`);
        return true;
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

export interface RenderOptions {
  /** CSS selector to wait for before capturing (best-effort; non-fatal if absent). */
  waitFor?: string;
  /** Scroll to the bottom repeatedly to trigger lazy-loaded / infinite grids. */
  scroll?: boolean;
  /** Click a "load more" style button until it disappears. */
  loadMoreSelector?: string;
  /** Extra settle time after network idle. */
  settleMs?: number;
  /** Hard wall-clock ceiling for this render (ms). Defaults to BROWSER_DEADLINE. */
  deadlineMs?: number;
}

/**
 * Render `url` in a real browser and return the final serialized DOM.
 * Blocks images/fonts/media so pages render fast and cheap; CSS and JS are
 * allowed through because client-rendered grids need their bundles.
 */
async function renderPageInner(url: string, opts: RenderOptions, deadline: number): Promise<string> {
  const browser = await getBrowser();
  let ctx: BrowserContext | null = null;
  try {
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 1000 },
      locale: "en-GB",
      timezoneId: "Europe/London",
      extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" },
    });
    // Strip the obvious automation tell some bot-checks look for.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await ctx.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);

    // Skip heavy assets we never read.
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "media") return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    // networkidle is best-effort: analytics beacons keep some sites permanently busy.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Must happen before waiting for content or scrolling: the banner blocks both.
    if (await dismissConsent(page)) {
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_500); // grid renders after the overlay clears
    }

    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor, { timeout: 15_000 }).catch(() => {});
    }

    // "Load more" paging. Portfolio grids commonly render 20-40 of several
    // hundred companies and reveal the rest only on click, so without this a
    // source silently yields a fraction of its portfolio and still looks fine.
    {
      const selectors = opts.loadMoreSelector
        ? [opts.loadMoreSelector]
        : ["button:has-text('Load more')", "button:has-text('Show more')",
           "a:has-text('Load more')", "a:has-text('Show more')",
           "[class*='load-more' i]", "[class*='loadMore']"];
      let clicks = 0;
      for (let i = 0; i < LOAD_MORE_CLICKS && Date.now() < deadline; i++) {
        let clicked = false;
        for (const sel of selectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
            await btn.click({ timeout: 5_000 }).catch(() => {});
            await page.waitForTimeout(1_000);
            clicked = true;
            clicks++;
            break;
          }
        }
        if (!clicked) break;
      }
      if (clicks) console.log(`[browser] clicked "load more" ${clicks}x`);
    }

    if (opts.scroll !== false) {
      let lastHeight = 0;
      let stable = 0;
      for (let i = 0; i < MAX_SCROLLS * 3 && Date.now() < deadline; i++) {
        const h = await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return document.body.scrollHeight;
        });
        await page.waitForTimeout(700);
        // Require two consecutive no-growth passes: lazy grids often pause
        // while fetching the next page, and breaking on the first flat read
        // stops well short of the full list.
        if (h === lastHeight) {
          if (++stable >= 2) break;
        } else {
          stable = 0;
          lastHeight = h;
        }
      }
    }

    await page.waitForTimeout(opts.settleMs ?? SETTLE_MS);

    // Merge substantial child frames into the returned HTML.
    //
    // Some sites are a thin shell around an iframe holding the real content:
    // localglobe.vc embeds phoenixcourt.vc, so page.content() returned only the
    // outer shell plus a cookie banner and the portfolio grid was invisible to
    // every downstream step. Same-origin restrictions do not apply here because
    // Playwright reads frames through the browser, not through the DOM.
    const parts = [await page.content()];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const url = frame.url();
      // Consent CMPs and ad/analytics frames are noise, never content.
      if (!url || url === "about:blank") continue;
      if (/consent|cookiebot|onetrust|doubleclick|googletagmanager|hotjar|intercom|youtube|vimeo/i.test(url)) continue;
      const html = await frame.content().catch(() => "");
      if (html.length > 2_000) {
        console.log(`[browser] merging iframe content from ${url} (${html.length} chars)`);
        parts.push(html);
      }
    }
    return parts.join("\n<!-- frame boundary -->\n");
  } finally {
    await ctx?.close().catch(() => {});
  }
}

/**
 * Public entry point: `renderPageInner` under a hard wall-clock deadline.
 *
 * The inner render races a timer. If the timer wins we still want whatever the
 * page had rendered by then, so the inner call keeps running and we return its
 * result if it lands shortly after; otherwise we surface a timeout error and the
 * caller falls back to the plain-HTTP HTML.
 */
export async function renderPage(url: string, opts: RenderOptions = {}): Promise<string> {
  const budget = opts.deadlineMs ?? RENDER_DEADLINE;
  const deadline = Date.now() + budget;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      renderPageInner(url, opts, deadline),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`render deadline ${budget}ms exceeded`)),
          budget,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
