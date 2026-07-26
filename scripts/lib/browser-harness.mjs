/*
 * browser-harness.mjs — the shared plumbing for gates that need a real browser.
 *
 * Two gates run code in Chromium against the Astro dev server: `check-parity` (the GPU shader
 * against its CPU reference) and `check-webgl-camera` (the raymarcher and the star pass agreeing
 * about where the camera is). Both need the same three things — a dev server, a browser, and a
 * page on the right origin — and the second was about to grow its own copy of all of it, which is
 * the duplication this codebase keeps having to design against.
 *
 * WHY A DEV SERVER AND NOT `dist/`. The modules these gates drive are dev-only by design:
 * `parity.ts` is never imported, so the production build tree-shakes it away, and both need Vite
 * to resolve bare specifiers like `three`. `dist/` cannot serve them.
 *
 * WHY THERE IS NO SKIP PATH. A browser gate that quietly does nothing when Chromium is missing
 * reads as coverage while providing none — and this repository has just spent a day removing
 * exactly that class of thing. Every failure here is loud, and the messages say what to do.
 */
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";

const DEFAULT_PORT = Number(process.env.PARITY_PORT ?? 4321);

async function serverResponds(origin) {
  try {
    const r = await fetch(origin, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Run `fn(page)` against a dev server and a headless browser, then clean both up.
 *
 * Reuses a dev server already listening — the common case while working, and it means the gate
 * picks up whatever is on disk without a restart. Starts one only if it has to, and stops only
 * what it started: killing a server the developer was using would be a rude way to fail a check.
 */
export async function withBrowserPage(fn, opts = {}) {
  const port = opts.port ?? DEFAULT_PORT;
  const origin = `http://localhost:${port}`;
  const log = opts.log ?? (() => {});

  let startedByUs = false;
  if (await serverResponds(origin)) {
    log(`  reusing the dev server already on ${origin}`);
  } else {
    log(`  starting a dev server on ${origin}…`);
    spawn("pnpm", ["exec", "astro", "dev", "--background", "--port", String(port)], {
      stdio: "ignore",
    });
    startedByUs = true;
    const deadline = Date.now() + 90_000;
    let up = false;
    while (Date.now() < deadline) {
      if (await serverResponds(origin)) { up = true; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) {
      throw new Error(
        `the dev server did not come up on ${origin} within 90s.\n` +
          `  Start one yourself with 'pnpm dev' and re-run, or set PARITY_PORT.`,
      );
    }
  }

  const stopServer = () => {
    if (startedByUs) spawnSync("pnpm", ["exec", "astro", "dev", "stop"], { stdio: "ignore" });
  };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      /*
       * PW_CHROME is the escape hatch for a machine where `npx playwright install` cannot fetch a
       * binary — locked down, offline, or air-gapped. Pointing at an existing Chrome works because
       * these gates need a GPU-capable browser, not a specific build.
       */
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
      ...(opts.args ? { args: opts.args } : {}),
    });
  } catch (e) {
    stopServer();
    throw new Error(
      `could not launch Chromium: ${String(e).split("\n")[0]}\n` +
        `  Install it with 'npx playwright install chromium', or set PW_CHROME to a browser binary.\n` +
        `  This gate does NOT skip when the browser is missing — see this file's header.`,
    );
  }

  const pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    return { result: await fn(page), pageErrors };
  } finally {
    await browser.close();
    stopServer();
  }
}

/** A tiny pass/fail reporter, matching the house style of the node gates. */
export function makeReporter(title) {
  let failures = 0;
  console.log(`${title}:`);
  return {
    ok(cond, msg) {
      console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
      if (!cond) failures++;
    },
    log: (s = "") => console.log(s),
    get failures() {
      return failures;
    },
    finish(okMsg, failHint = "") {
      if (failures) {
        console.error(`\n✗ ${title} — ${failures} failure(s).${failHint ? `\n${failHint}` : ""}`);
        process.exit(1);
      }
      console.log(`\n✓ ${okMsg}`);
    },
  };
}
