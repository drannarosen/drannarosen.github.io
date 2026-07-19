/*
 * scene.ts — cluster data types + loader.
 *
 * A Scene is the immutable data a cluster render needs: the density volume, the
 * stars, and the log-colorbar anchors derived from the export's meta.json. View
 * is the mutable camera/orientation state the engine and interaction layer share.
 */

export interface Scene {
  volume: Uint8Array; // ngrid^3, C-order uint8 log10(rho)
  ngrid: number;
  stars: Float32Array; // n*6: x,y,z,mass,teff,radius (pc, Msun, K, Rsun)
  box: number; // pc
  /** Normalized position (0..1) of rho_0 in the texture's log range = default floor. */
  densityFloor: number;
  logRange: number; // logMax - logMin (dex), for the expansion's 1/S^3 dilution
  floorMedian: number; // normalized position of the median density (default floor)
  floorMean: number; // normalized position of the volume-weighted mean density
}

/** Mutable camera/orientation state, shared by the engine and interaction layer. */
export interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
  spin: boolean;
}

export async function loadScene(base = "/data/gravoturb"): Promise<Scene> {
  const [meta, volBuf, starBuf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json()),
    fetch(`${base}/volume.u8`).then((r) => r.arrayBuffer()),
    fetch(`${base}/stars.f32`).then((r) => r.arrayBuffer()),
  ]);
  return sceneFromParts(meta, new Uint8Array(volBuf), new Float32Array(starBuf));
}

/** Build a Scene from already-fetched parts (meta.json + volume + stars). */
export function sceneFromParts(
  meta: Record<string, number>,
  volume: Uint8Array,
  stars: Float32Array,
): Scene {
  const lo = meta.volume_log_min, hi = meta.volume_log_max;
  // rho_0 for the log colorbar. The volume-weighted MEAN sits ~1 dex above the
  // median for a lognormal field, so a mean floor shows only the dense core;
  // anchor the default at the MEDIAN so the filamentary cloud beyond it shows.
  const norm = (x: number) => (hi > lo ? (x - lo) / (hi - lo) : 0);
  const median = meta.volume_log_median ?? meta.volume_log_mean ?? lo;
  const mean = meta.volume_log_mean ?? median;
  const floorMedian = norm(median), floorMean = norm(mean);
  return {
    volume,
    ngrid: meta.volume_ngrid,
    stars,
    box: meta.box_pc,
    densityFloor: floorMedian,
    logRange: hi - lo,
    floorMedian,
    floorMean,
  };
}
