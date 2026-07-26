/*
 * check-webgl-camera.mjs — the gas and the stars must agree about where the camera is.
 *
 * ── WHAT THIS CATCHES THAT A NODE TEST CANNOT ──
 *
 * `viz/webgl` draws each frame in two passes with two different formulations of one camera: the
 * volume fragment shader inverse-transforms the RAY, the star vertex shader forward-projects the
 * POINT. `camera.ts` now holds the three numbers once and `camera.test.ts` checks that the closed
 * form inverts the ray march — in node, with no GPU.
 *
 * That is not sufficient, and this gate exists because it was PROVEN not to be. `camera.ts`'s
 * rotation was written reading GLSL's `mat3(c,0.,s, ...)` as ROWS when it is COLUMNS, giving the
 * transpose — which for a rotation is its inverse. The node test passed anyway: its "independent"
 * reference had been written in the same sitting and carried the same misreading, so both sides
 * agreed and both were wrong. The error is exactly zero at yaw = pitch = 0 and grows with angle:
 * 13.4 px at yaw 0.6, 11.3 px at pitch 0.4, on a 400x300 frame.
 *
 * The only thing that catches that is rendering on a GPU and looking at where the star landed. So
 * this puts ONE star at a known position, renders it through the real compiled shader, and
 * compares the brightness-weighted centroid against `projectToUv`'s prediction.
 *
 * ── WHY IT MATTERS BEYOND CORRECTNESS ──
 *
 * A de-registered camera does not crash and does not look broken. It puts stars slightly off
 * their gas — and /explore/mass-segregation is a figure whose entire claim is WHERE the massive
 * stars sit relative to the cloud. A wrong answer there is rendered convincingly.
 */
import { withBrowserPage, makeReporter } from "./lib/browser-harness.mjs";

/*
 * Measured against the compiled shader on 2026-07-26 (Apple M2 Max, headless Chrome for Testing):
 * every case agreed to within 0.02 px once the rotation convention was fixed. The bound below is
 * 0.5 px — an order of magnitude above that, and still far under the ~10 px error the bug
 * produced, so it discriminates without being fitted to the measurement.
 */
const TOLERANCE_PX = 0.5;

/*
 * Each case pairs a view with star positions chosen to land INSIDE the frame.
 *
 * That pairing is not cosmetic. At ZOOM_MIN the projection magnifies ~2.9x, and the first version
 * of this gate swept every star against every view — which put two of them off the edge. A star
 * partly outside the frame has a CLIPPED centroid, so it reports a large offset while the
 * prediction is perfectly correct (measured: predicted y = -9.7 on a 300 px frame, apparent error
 * 10.8 px). A star fully outside lights nothing and would agree with any prediction at all.
 *
 * Both are measurement artefacts that look exactly like a camera bug, so the gate asserts
 * in-frame-ness below rather than trusting these choices to stay valid.
 */
const CASES = [
  { view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 }, stars: [[0, 0, 0], [1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] },
  { view: { yaw: 0.6, pitch: 0, zoom: 1, panX: 0, panY: 0 }, stars: [[0, 0, 0], [1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] }, // DEFAULT_YAW
  { view: { yaw: -0.6, pitch: 0, zoom: 1, panX: 0, panY: 0 }, stars: [[1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] },
  { view: { yaw: 0, pitch: 0.4, zoom: 1, panX: 0, panY: 0 }, stars: [[1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] },
  { view: { yaw: 0, pitch: -0.4, zoom: 1, panX: 0, panY: 0 }, stars: [[1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] },
  { view: { yaw: 0.6, pitch: 0.25, zoom: 1, panX: 0, panY: 0 }, stars: [[0, 0, 0], [1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] },
  /* ZOOM_MIN magnifies, so only near-centre stars stay in frame. */
  { view: { yaw: 1.9, pitch: -0.7, zoom: 0.35, panX: 0, panY: 0 }, stars: [[0, 0, 0], [0.3, -0.2, 0.1]] },
  /* ZOOM_MAX shrinks everything toward the centre, so the wide positions are fine. */
  { view: { yaw: -2.4, pitch: 0.8, zoom: 4.0, panX: 0, panY: 0 }, stars: [[0, 0, 0], [1.2, -0.8, 0.4], [-1.5, 1.1, -0.6]] },
  /* Pan is applied by BOTH shaders and is the other way they can de-register. */
  { view: { yaw: 0.6, pitch: 0.25, zoom: 1, panX: 0.12, panY: -0.08 }, stars: [[0, 0, 0], [1.2, -0.8, 0.4]] },
];

/** How far inside the frame a prediction must sit for its centroid to be unclipped. */
const FRAME_MARGIN_PX = 30;

const r = makeReporter("webgl-camera (the gas and the stars share one camera)");

const { result, pageErrors } = await withBrowserPage(
  async (page) =>
    page.evaluate(
      async ({ CASES, FRAME_MARGIN_PX }) => {
        const eng = await import("/src/novascope/viz/webgl/engine.ts");
        const sc = await import("/src/novascope/viz/webgl/scene.ts");
        const cam = await import("/src/novascope/viz/webgl/camera.ts");

        const W = 400, H = 300, BOX = 6, N = 4;
        const rows = [];

        for (const { view, stars } of CASES) {
          for (const pos of stars) {
            const canvas = document.createElement("canvas");
            /* The engine sizes its backing store from getBoundingClientRect; a detached canvas
             * reports zeros, so this pins a known frame and keeps dpr at 1. */
            Object.defineProperty(canvas, "getBoundingClientRect", {
              value: () => ({ width: W, height: H, top: 0, left: 0, right: W, bottom: H, x: 0, y: 0 }),
            });
            document.body.appendChild(canvas);

            /* An ALL-ZERO volume renders fully transparent, so the only lit pixels are the star.
             * That is what makes a centroid meaningful. */
            const scene = sc.sceneFromParts(
              { volume_log_min: 0, volume_log_max: 4, volume_log_median: 1, volume_log_mean: 2, volume_ngrid: N, box_pc: BOX },
              new Uint8Array(N * N * N),
              new Float32Array([...pos, 10, 30000, 5]),
            );
            const e = eng.createEngine(canvas, scene, { reducedMotion: true });
            e.setView({ ...view, spin: false });
            e.redraw();

            const gl = canvas.getContext("webgl2");
            const px = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);

            /* Brightness-weighted centroid. `+ 0.5` because a pixel at index x covers [x, x+1)
             * and its CENTRE is x + 0.5 — without it every measurement is off by exactly half a
             * pixel, which is small enough to be mistaken for a real disagreement. readPixels is
             * bottom-up, and the prediction below is computed in the same orientation. */
            let sx = 0, sy = 0, sw = 0, lit = 0;
            for (let y = 0; y < canvas.height; y++) {
              for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                const v = Math.max(px[i], px[i + 1], px[i + 2]);
                if (v > 8) { sx += (x + 0.5) * v; sy += (y + 0.5) * v; sw += v; lit++; }
              }
            }

            const uv = cam.projectToUv([pos[0] / BOX, pos[1] / BOX, pos[2] / BOX], view);
            const aspect = canvas.width / canvas.height;
            /* The clip-space mapping from STAR_VS:
             *   gl_Position = vec4((clipx + uPan.x)*2/uAspect, (clipy + uPan.y)*2, 0, 1) */
            const clipX = (uv.u + view.panX) * 2 / aspect;
            const clipY = (uv.v + view.panY) * 2;
            const predX = (clipX * 0.5 + 0.5) * canvas.width;
            const predY = (clipY * 0.5 + 0.5) * canvas.height;

            rows.push({
              view: `yaw ${view.yaw} pitch ${view.pitch} zoom ${view.zoom}${view.panX ? ` pan ${view.panX},${view.panY}` : ""}`,
              pos: pos.join(","),
              lit,
              predX, predY,
              inFrame:
                predX >= FRAME_MARGIN_PX && predX <= canvas.width - FRAME_MARGIN_PX &&
                predY >= FRAME_MARGIN_PX && predY <= canvas.height - FRAME_MARGIN_PX,
              dx: sw ? sx / sw - predX : Number.NaN,
              dy: sw ? sy / sw - predY : Number.NaN,
            });
            e.cleanup();
            canvas.remove();
          }
        }
        return rows;
      },
      { CASES, FRAME_MARGIN_PX },
    ),
  { log: r.log },
);

let worst = 0;
let worstAt = "";
const offFrame = result.filter((row) => !row.inFrame);
const unlit = result.filter((row) => row.inFrame && !row.lit);
for (const row of result) {
  if (!row.inFrame || !row.lit) continue;
  const d = Math.hypot(row.dx, row.dy);
  if (d > worst) { worst = d; worstAt = `${row.view} · star ${row.pos}`; }
}

r.log();
/*
 * Both of these are TEST-DESIGN failures rather than renderer failures, and they are asserted
 * rather than skipped for the reason this whole gate exists: a configuration that quietly stops
 * measuring anything is indistinguishable from one that passes.
 */
r.ok(
  offFrame.length === 0,
  offFrame.length === 0
    ? `all ${result.length} configurations put the star inside the frame (${FRAME_MARGIN_PX} px margin)`
    : `${offFrame.length} configuration(s) predict a star OUTSIDE the frame, where a clipped ` +
      `centroid mimics a camera bug — fix the case, not the camera: ` +
      offFrame.map((o) => `${o.view} star ${o.pos} -> (${o.predX.toFixed(0)}, ${o.predY.toFixed(0)})`).join("; "),
);
r.ok(
  unlit.length === 0,
  `every in-frame configuration rendered a star — an unlit frame would agree with any prediction`,
);
r.ok(
  worst <= TOLERANCE_PX,
  `worst centroid offset ${worst.toFixed(3)} px across ${result.length} configurations ` +
    `(limit ${TOLERANCE_PX}) — worst at ${worstAt || "n/a"}`,
);
r.ok(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0].slice(0, 160)}` : ""}`);

r.finish(
  "webgl-camera ok — the star pass lands where the volume's camera says it should.",
  "  The volume raymarch and the star projection disagree. Before suspecting the shaders, check\n" +
    "  camera.ts's rotation: GLSL's mat3(...) takes COLUMNS, and reading it as rows gives the\n" +
    "  transpose — zero error at yaw = pitch = 0, growing with angle.",
);
