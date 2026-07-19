#!/usr/bin/env python
"""Export one gravoturb cluster IC to web-ready data for drannarosen.github.io.

This is a thin BRIDGE. Anna's progenax `gravoturb` model is the source of truth;
this script builds a single initial-condition realization and writes flat,
float32 arrays the website can read directly. It performs no physics of its own.

It reuses `feasibility_figure.build()` so the exported cluster is byte-identical
to the "career" figure's construction (same IMF seed, cloud, envelope, and the
mass-segregation knob `lambda_corr`).

--------------------------------------------------------------------------------
Run it (from the website repo root), pointing at Anna's jaxstro checkout:

  JAXSTRO=$HOME/projects/jaxstro-dev
  PYTHONPATH="$JAXSTRO/progenax/src/experimental:$JAXSTRO/progenax/src" \
    "$JAXSTRO/progenax/.venv/bin/python" scripts/gravoturb/export_cluster.py

Override the checkout location with the JAXSTRO env var if it lives elsewhere.
--------------------------------------------------------------------------------

Outputs (public/data/gravoturb/):
  stars.f32   flat little-endian float32, N rows of [x, y, z, mass, teff, radius]
              x,y,z in pc (cluster-centered); mass in M_sun; teff in K; radius in R_sun
  gas.f32     flat little-endian float32, row-major [NGRID x NGRID],
              log10 of the projected gas surface density  log10(Sigma_cl / [M_sun pc^-2])
  meta.json   shapes, ranges, physical extents, and provenance (seed, lambda_corr)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

# --- locate Anna's model -----------------------------------------------------
JAXSTRO = Path(os.environ.get("JAXSTRO", Path.home() / "projects" / "jaxstro-dev"))
GRAVOTURB_VALIDATION = (
    JAXSTRO / "progenax" / "src" / "experimental" / "gravoturb" / "validation"
)
for p in (
    str(JAXSTRO / "progenax" / "src" / "experimental"),
    str(JAXSTRO / "progenax" / "src"),
):
    if p not in sys.path:
        sys.path.insert(0, p)

# feasibility_figure resolves its own relative imports from its directory
os.chdir(GRAVOTURB_VALIDATION)
sys.path.insert(0, str(GRAVOTURB_VALIDATION))

import jax.numpy as jnp  # noqa: E402
import feasibility_figure as ff  # noqa: E402
from progenax.stellar import zams_effective_temperature, zams_radius  # noqa: E402

# --- knobs -------------------------------------------------------------------
LAMBDA_CORR = 0.6  # mass<->natal-density coupling (0 = none, 0.6 = career figure)
NGRID = 128  # gas-field grid resolution (career figure uses 96; higher = crisper)
GAS_POINTS = 55000  # 3D gas "motes" (for the rotating/expelling cloud)

# Override the module's grid so build() constructs the field at NGRID^3. Higher
# resolution RE-SAMPLES the turbulent field (finer structure), same physics/params.
ff.NGRID = NGRID
ff.DX = ff.BOX / NGRID
BOX = ff.BOX
DX = ff.DX
build = ff.build
OUT = (
    Path(__file__).resolve().parents[2] / "public" / "data" / "gravoturb"
)  # <repo>/public/data/gravoturb


def main() -> None:
    print(f"[build] IC lambda_corr={LAMBDA_CORR}  N grid={NGRID}^3 ...", flush=True)
    ic = build(lambda_corr=LAMBDA_CORR)

    # --- gas: project the 3D cloud density to a 2D surface density, take log10 ---
    rho = np.asarray(ic.gas.rho_cloud)  # (NGRID, NGRID, NGRID)

    # Spherical window: the turbulent field fills the CUBIC box, which reads as a
    # cube when rendered. Fade the density to zero beyond an inscribed sphere so
    # the cloud (2D projection AND 3D motes) is spherical. Smoothstep taper.
    ax = (np.arange(NGRID) + 0.5) / NGRID - 0.5
    XX, YY, ZZ = np.meshgrid(ax, ax, ax, indexing="ij")
    rr = np.sqrt(XX * XX + YY * YY + ZZ * ZZ) / 0.5  # 1.0 at a face center
    win = np.clip((0.98 - rr) / (0.98 - 0.5), 0.0, 1.0)
    win = win * win * (3 - 2 * win)  # smoothstep 1 -> 0 between r=0.5 and 0.98
    rho = rho * win.astype(rho.dtype)
    cell_volume = float(ic.gas.cell_volume)
    col = rho.sum(axis=2) * cell_volume / DX**2  # M_sun / pc^2
    floor = float(col[col > 0].min())
    gas_log = np.log10(np.maximum(col, floor)).astype(np.float32)  # (NGRID, NGRID)

    # --- 3D gas point cloud: sample cells ∝ density so points trace the real
    # filaments and dense core. Grid indices fit exactly in a byte (NGRID<=256);
    # density is log-scaled to a byte for brightness. These points rotate with
    # the stars and drive the gas-expulsion animation (fade + radial outflow). ---
    rng = np.random.default_rng(0)
    flat = rho.reshape(-1)
    # Sample ∝ rho^0.55 (not rho): spreads motes into the diffuse gas so the
    # cloud fills, instead of cramming them all in the dense core. The per-mote
    # density value below still carries the TRUE density for brightness/size.
    wsamp = np.power(flat, 0.55)
    idx = rng.choice(flat.size, size=GAS_POINTS, replace=True, p=wsamp / wsamp.sum())
    ijk = np.stack(np.unravel_index(idx, rho.shape), axis=1).astype(np.uint8)  # 0..NGRID-1
    dpt = flat[idx]
    dpt_log = np.log10(np.maximum(dpt, dpt[dpt > 0].min()))
    dq = ((dpt_log - dpt_log.min()) / np.ptp(dpt_log) * 255).astype(np.uint8)
    gas_points = np.column_stack([ijk, dq]).astype(np.uint8)  # (GAS_POINTS, 4): i,j,k,dens

    # --- stars: real 3D positions + ZAMS temperature & radius from the masses ---
    pos = np.asarray(ic.stars.positions)  # (N, 3), pc (frame origin subtracted below)
    mass = np.asarray(ic.stars.masses)  # (N,), M_sun
    origin = np.asarray(ic.ledger.frame.origin)  # (3,)
    # A star maps to gas cell (pos + origin)/BOX*NGRID (see feasibility_figure), so
    # place stars in that same box frame and recenter on the box middle. This keeps
    # the stars registered over the projected gas field.
    xyz = (pos + origin[:3]) - (BOX / 2.0)  # pc, cluster/box centered
    m_clip = jnp.clip(jnp.asarray(mass), 0.08, 150.0)
    teff = np.asarray(zams_effective_temperature(m_clip), dtype=np.float32)
    radius = np.asarray(zams_radius(m_clip), dtype=np.float32)

    stars = np.column_stack(
        [xyz[:, 0], xyz[:, 1], xyz[:, 2], mass, teff, radius]
    ).astype(np.float32)

    # --- write -----------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    stars.tofile(OUT / "stars.f32")
    gas_log.tofile(OUT / "gas.f32")
    gas_points.tofile(OUT / "gas_points.u8")
    meta = {
        "provenance": "progenax gravoturb IC (feasibility_figure.build)",
        "lambda_corr": LAMBDA_CORR,
        "n_stars": int(stars.shape[0]),
        "star_fields": ["x", "y", "z", "mass", "teff", "radius"],
        "star_units": ["pc", "pc", "pc", "Msun", "K", "Rsun"],
        "ngrid": int(NGRID),
        "box_pc": float(BOX),
        "gas_log_min": float(gas_log.min()),
        "gas_log_max": float(gas_log.max()),
        "gas_field": "log10(Sigma_cl / [Msun pc^-2]), row-major NGRID x NGRID",
        "n_gas_points": int(gas_points.shape[0]),
        "gas_point_fields": ["i", "j", "k", "dens"],
        "gas_point_encoding": (
            "uint8: i,j,k are grid indices 0..NGRID-1 "
            "(pc = (idx+0.5)/NGRID*box - box/2); dens is log-scaled 0..255"
        ),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))

    print(f"[ok] stars {stars.shape} -> {(OUT / 'stars.f32').stat().st_size/1024:.0f} KB")
    print(f"[ok] gas   {gas_log.shape} -> {(OUT / 'gas.f32').stat().st_size/1024:.0f} KB")
    print(f"[ok] gas_points {gas_points.shape} -> "
          f"{(OUT / 'gas_points.u8').stat().st_size/1024:.0f} KB")
    print(f"[ok] mass {mass.min():.3f}..{mass.max():.0f} Msun  "
          f"teff {teff.min():.0f}..{teff.max():.0f} K")
    print(f"[done] wrote {OUT}")


if __name__ == "__main__":
    main()
