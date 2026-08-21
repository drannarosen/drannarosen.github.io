/*
 * browser-harness.mjs — the shared plumbing for gates that need a real browser.
 *
 * Four gates run code in a browser against the Astro dev server: `check-parity` (the GPU shader
 * against its CPU reference), `check-webgl-camera` (the raymarcher and the star pass agreeing
 * about where the camera is), `check-cluster-points` (the star renderer against a pinned image)
 * and `check-volume-parity` (the volume raymarch against its TypeScript reference). All need the
 * same three things — a dev server, a browser, and a page on the right origin — and the second was
 * about to grow its own copy of all of it, which is the duplication this codebase keeps having to
 * design against.
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

  /*
   * WHICH BROWSER, AND WHY IT DECIDES WHAT THESE GATES CAN SEE
   *
   * Playwright's BUNDLED Chromium has no WebGPU adapter and falls back to a SwiftShader SOFTWARE
   * rasteriser. System Chrome has a real device. Measured on this machine, against the dev server
   * (a secure origin — `about:blank` is not, and reports WebGPU as universally absent):
   *
   *   bundled chromium      adapter NULL          ANGLE (Google, Vulkan/SwiftShader)
   *   channel "chrome"      adapter apple/metal-3 ANGLE (Apple, Metal Renderer: Apple M2 Max)
   *   PW_CHROME=<path>      adapter apple/metal-3 ANGLE (Apple, Metal Renderer: Apple M2 Max)
   *
   * So the browser is not an implementation detail here. It selects the BACKEND (`check-parity`
   * and `check-volume-parity` cover one path instead of two without it) and the RASTERISER
   * (`check-cluster-points` pins an image, and changing the rasteriser moves that image further
   * than changing the backend does — see its header).
   *
   * System Chrome is therefore the DEFAULT, discovered through Playwright's own `channel`, which
   * works on macOS, Windows and Linux without this file keeping a list of paths. `PW_CHROME` still
   * wins when set, for a browser Playwright's registry does not know about.
   *
   * This used to describe `PW_CHROME` as an escape hatch for offline or locked-down machines that
   * cannot fetch a binary. That was wrong, and it was the copy four gates read: it reads as an
   * optional convenience when it is the difference between a gate covering both backends on real
   * hardware and covering one on software. `check-cluster-points` had the measured truth in its own
   * header the whole time, which is how the two came to disagree.
   */
  let browser;
  let browserLabel;
  const launchOpts = { headless: true, ...(opts.args ? { args: opts.args } : {}) };
  try {
    if (process.env.PW_CHROME) {
      browser = await chromium.launch({ ...launchOpts, executablePath: process.env.PW_CHROME });
      browserLabel = `system Chrome via PW_CHROME (${process.env.PW_CHROME})`;
    } else {
      try {
        browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
        browserLabel = "system Chrome (Playwright channel 'chrome')";
      } catch {
        /* Not fatal — a software run is still a run, and CI does exactly this today. But it is
           never silent: a gate reporting coverage it does not have is the thing this file's header
           refuses to allow, and the operator cannot infer it from a passing line. */
        browser = await chromium.launch(launchOpts);
        browserLabel = "Playwright's bundled Chromium — SOFTWARE, no WebGPU adapter";
        console.warn(
          `  NOTE: no system Chrome found — running Playwright's bundled Chromium, which has NO\n` +
            `  WebGPU adapter and rasterises in software (SwiftShader). A gate that pins an image\n` +
            `  will fail against a hardware pin; a gate that only reports its backend will cover\n` +
            `  one path and still pass.\n` +
            `  Fix with 'pnpm exec playwright install chrome', or set PW_CHROME to a browser binary.`,
        );
      }
    }
  } catch (e) {
    stopServer();
    throw new Error(
      `could not launch a browser: ${String(e).split("\n")[0]}\n` +
        `  Install one with 'pnpm exec playwright install chrome' (hardware WebGPU and rasteriser)\n` +
        `  or 'pnpm exec playwright install chromium' (software), or set PW_CHROME to a binary.\n` +
        `  This gate does NOT skip when the browser is missing — see this file's header.`,
    );
  }
  log(`  browser: ${browserLabel}`);

  const pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    /*
     * IS THERE A WEBGPU DEVICE, measured once and handed to the gates.
     *
     * A gate that merely REPORTS its backend passes whether or not the WebGPU path ran, which is
     * how `check-parity` and `check-volume-parity` could cover one of two paths and still go green
     * — the exact failure `parity.ts` records costing months. The fix is not to demand WebGPU
     * unconditionally: a GPU-less runner has no adapter and its WebGL 2 run is the honest result,
     * and ~5% of real visitors take that path too.
     *
     * So the discriminator is the ADAPTER, not the browser. With one present, a run that fell back
     * to WebGL 2 is hiding a backend and the gate should say so; with none, there is nothing to
     * hide. Asking the browser is the only way to tell the two apart — `channel: "chrome"` can
     * succeed on a machine that still has no device.
     *
     * Measured on the dev server, which is a secure context. `about:blank` is not, and reports
     * `navigator.gpu` as undefined for reasons that have nothing to do with the hardware.
     */
    const webgpuAdapter = await page.evaluate(async () => {
      if (!navigator.gpu) return null;
      try {
        const a = await navigator.gpu.requestAdapter();
        if (!a) return null;
        const i = a.info ?? {};
        return [i.vendor, i.architecture].filter(Boolean).join("/") || "adapter";
      } catch {
        return null;
      }
    });
    log(`  WebGPU adapter: ${webgpuAdapter ?? "none — the WebGPU path cannot run here"}`);
    return { result: await fn(page), pageErrors, webgpuAdapter };
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
