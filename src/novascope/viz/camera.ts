/*
 * viz/camera.ts — a tiny orbit camera + pointer interaction for the cluster
 * panel (Layer 2). Canvas projection only, no 3-D library: the cluster's latent
 * positions are already 3-D (pc), so 2-D is just the camera with no rotation.
 *
 * 2-D mode: orthographic top-down (yaw=pitch=0). 3-D mode: orbit (yaw/pitch),
 * weak perspective, depth-sorted and depth-cued. Zoom and pan work in both.
 */
export interface Camera {
  mode: "2D" | "3D";
  yaw: number; // radians, about the vertical axis
  pitch: number; // radians, about the horizontal axis
  zoom: number; // multiplier
  panX: number; // px
  panY: number; // px
}

export function makeCamera(mode: "2D" | "3D" = "2D"): Camera {
  return { mode, yaw: mode === "3D" ? 0.5 : 0, pitch: mode === "3D" ? 0.35 : 0, zoom: 1, panX: 0, panY: 0 };
}

export interface Projected {
  sx: number; // screen x (px)
  sy: number; // screen y (px)
  depth: number; // rotated z (larger = farther); for painter sort
  persp: number; // perspective/size multiplier (nearer > 1)
}

/**
 * Project a cluster point (pc, centred near 0) to the canvas. `maxR` is the
 * cluster's plot radius (pc); the camera distance scales with it so perspective
 * stays gentle regardless of cluster size.
 */
export function project(
  x: number,
  y: number,
  z: number,
  cam: Camera,
  w: number,
  h: number,
  maxR: number,
): Projected {
  const base = ((Math.min(w, h) / 2) * 0.9) / (maxR || 1);
  const s = base * cam.zoom;

  if (cam.mode === "2D") {
    return { sx: w / 2 + x * s + cam.panX, sy: h / 2 + y * s + cam.panY, depth: z, persp: 1 };
  }

  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);

  // Yaw about vertical (y), then pitch about horizontal (x).
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp; // depth toward viewer

  const D = 4 * (maxR || 1);
  const persp = D / (D - z2);
  return {
    sx: w / 2 + x1 * s * persp + cam.panX,
    sy: h / 2 + y2 * s * persp + cam.panY,
    depth: -z2, // farther first when sorted ascending
    persp,
  };
}

/**
 * Drag to orbit (3-D), wheel to zoom, shift-drag (or two-finger) to pan.
 *
 * The pane is "armed" only after a pointer press, and disarms when the pointer
 * leaves. Wheel-zoom is ignored until armed, so scrolling the page OVER an
 * un-clicked pane scrolls the page instead of hijacking it into a zoom. `onArm`
 * reports the state so the caller can update its affordance (hint, ring).
 */
export function attachOrbit(
  canvas: HTMLCanvasElement,
  cam: Camera,
  onChange: () => void,
  onArm?: (armed: boolean) => void,
): () => void {
  let dragging = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch0 = 0;
  let armed = false;
  const setArmed = (v: boolean) => {
    if (v === armed) return;
    armed = v;
    onArm?.(v);
  };

  const down = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    panning = e.shiftKey || e.button === 1;
    lastX = e.clientX;
    lastY = e.clientY;
    setArmed(true);
    if (pointers.size === 2) pinch0 = twoDist();
  };
  const leave = () => setArmed(false);
  const move = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const d = twoDist();
      if (pinch0 > 0) {
        cam.zoom = clampZoom(cam.zoom * (d / pinch0));
        pinch0 = d;
        onChange();
      }
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (panning) {
      cam.panX += dx;
      cam.panY += dy;
    } else if (cam.mode === "3D") {
      cam.yaw += dx * 0.01;
      cam.pitch = clampPitch(cam.pitch + dy * 0.01);
    } else {
      cam.panX += dx;
      cam.panY += dy;
    }
    onChange();
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = 0;
    if (pointers.size === 0) dragging = false;
  };
  const wheel = (e: WheelEvent) => {
    if (!armed) return; // not clicked yet — let the wheel scroll the page
    e.preventDefault();
    cam.zoom = clampZoom(cam.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    onChange();
  };
  function twoDist() {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("wheel", wheel, { passive: false });
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("wheel", wheel);
  };
}

const clampZoom = (z: number) => Math.min(8, Math.max(0.4, z));
const clampPitch = (p: number) => Math.min(Math.PI / 2 - 0.05, Math.max(-Math.PI / 2 + 0.05, p));
