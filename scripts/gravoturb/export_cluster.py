#!/usr/bin/env python
"""Export one gravoturb cluster IC to web-ready data for drannarosen.github.io.

This is a thin BRIDGE. Anna's progenax `gravoturb` model is the source of truth;
this script builds a single initial-condition realization and writes flat,
float32 arrays the website can read directly. It performs no physics of its own.

It reuses `feasibility_figure.build()` so the exported cluster is byte-identical
to the reference figure's construction (same IMF seed, cloud, envelope, and the
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

import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import feasibility_figure as ff  # noqa: E402
from progenax.profiles.eff import EFFProfile  # noqa: E402
from progenax.stellar import zams_effective_temperature, zams_radius  # noqa: E402

# --- knobs -------------------------------------------------------------------
LAMBDA_CORR = 0.6  # mass<->natal-density coupling (0 = none, 0.6 = reference figure)
NGRID = 128  # gas-field grid resolution (reference figure uses 96; higher = crisper)
N_STARS = 10000  # number of stars (reference figure uses 5000)
GAS_POINTS = 55000  # 3D gas "motes" (for the rotating/expelling cloud)

# Cloud radial SHAPE: EFF (Elson-Fall-Freeman 1987), rho ∝ (1+r^2/a^2)^(-gamma/2)
# TRUNCATED at r_t (rho=0 beyond). Unlike Plummer (gamma=5, untruncated r^-5 halo),
# the truncation gives the cloud a real, physical edge — so the rendered cloud is
# genuinely round with no far-flung stars, no geometric masking. r_t < box/2 keeps
# the cloud clear of the domain walls.
EFF_A = 0.8  # core scale radius [pc]
EFF_GAMMA = 3.0  # 3-D density slope (young-cluster ~3; gamma=5 recovers Plummer)
EFF_RT = 2.5  # truncation radius [pc]; box half-width is 3.0 pc

DYN_DEX = 6.0  # display dynamic range: clamp log-density to this many dex below peak

BOX = ff.BOX  # 6.0 pc
DX = BOX / NGRID
OUT = (
    Path(__file__).resolve().parents[2] / "public" / "data" / "gravoturb"
)  # <repo>/public/data/gravoturb


def main() -> None:
    print(
        f"[build] EFF IC a={EFF_A} gamma={EFF_GAMMA} r_t={EFF_RT} pc  "
        f"lambda_corr={LAMBDA_CORR}  N={N_STARS} grid={NGRID}^3 ...",
        flush=True,
    )
    # Same recipe as feasibility_figure.build(), but with a TRUNCATED EFF cloud
    # profile instead of Plummer — so the cloud edge is physical, not a render mask.
    masses = ff.IMF.sample(jax.random.PRNGKey(9), N_STARS)
    ic = ff.build_cluster_ic(
        masses,
        cloud=ff.CloudSpec(mach=8.0, b=0.5, alpha=1.8, beta=None, coupling="helmholtz"),
        geometry=ff.GeometrySpec(
            profile=EFFProfile(a=EFF_A, gamma=EFF_GAMMA, r_t=EFF_RT),
            box_size=BOX,
            shape=(NGRID,) * 3,
        ),
        velocity=ff.VelocitySpec(beta_v=4.0, mode="physical", c_s=0.2),
        composition=ff.CompositionSpec(lambda_corr=LAMBDA_CORR),
        G=ff.G,
        units=ff.STELLAR,
        key=jax.random.PRNGKey(1),
        gas=ff.GasSpec(sfe=0.2),
    )

    # --- gas: project the 3D cloud density to a 2D surface density, take log10 ---
    rho = np.asarray(ic.gas.rho_cloud)  # (NGRID, NGRID, NGRID)

    # --- 3D density VOLUME (uint8, log-scaled) for WebGL raymarching ----------
    # The real EFF-truncated field, as-is: rho=0 beyond r_t, so the cloud is
    # physically round with NO geometric masking anywhere in this pipeline.
    # C-order (i,j,k); the shader trilinearly samples it. uint8 is visually
    # lossless once mapped to a screen color.
    # CLAMP the display dynamic range to DYN_DEX below the peak density (standard
    # imshow vmin/vmax). The EFF-truncated exterior (~1e-300) and negligibly faint
    # cells clamp to the floor -> byte 0 (transparent); the uint8 levels then span
    # the real cloud contrast instead of ~300 dex of empty space.
    vhi = float(np.log10(rho.max()))
    vlo = vhi - DYN_DEX
    floor_rho = 10.0 ** vlo
    vlog = np.log10(np.clip(rho, floor_rho, None))
    vol_u8 = (np.clip((vlog - vlo) / (vhi - vlo), 0.0, 1.0) * 255.0).astype(np.uint8)

    # Reference density rho_0 for the web renderer's log colorbar (yt-style),
    # over the DISPLAYED cloud (rho above the clamp floor). The shader windows the
    # colormap to [rho_0, rho_max] = log10(rho/rho_0). Same log10 units as vlo/vhi.
    disp = rho > floor_rho
    log_mean = float(np.log10(rho[disp].mean()))
    log_median = float(np.log10(np.median(rho[disp])))

    # 2D projected surface density (log10) — line-of-sight sum of the real field.
    cell_volume = float(ic.gas.cell_volume)
    col = rho.sum(axis=2) * cell_volume / DX**2  # M_sun / pc^2
    cfloor = float(col.max()) * 1e-4  # sane projected floor (exterior columns ~0)
    gas_log = np.log10(np.maximum(col, cfloor)).astype(np.float32)  # (NGRID, NGRID)

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

    # Local gas density at each star's cell — the coupling KEY the mass-segregation
    # explorer re-pairs on (correlated_mass_assignment sorts positions by this and
    # assigns massive stars to dense cells with strength lambda_corr). Sampled from
    # the raw density field at the star's grid cell.
    cell = np.clip(np.floor((pos + origin[:3]) / BOX * NGRID).astype(int), 0, NGRID - 1)
    local_density = np.asarray(rho)[cell[:, 0], cell[:, 1], cell[:, 2]].astype(np.float32)

    # --- write -----------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    stars.tofile(OUT / "stars.f32")
    local_density.tofile(OUT / "local_density.f32")
    gas_log.tofile(OUT / "gas.f32")
    gas_points.tofile(OUT / "gas_points.u8")
    vol_u8.tofile(OUT / "volume.u8")
    meta = {
        "provenance": "progenax gravoturb build_cluster_ic (EFF truncated cloud)",
        "cloud_profile": "EFF (Elson-Fall-Freeman 1987), truncated at r_t",
        "eff_a_pc": EFF_A,
        "eff_gamma": EFF_GAMMA,
        "eff_r_t_pc": EFF_RT,
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
        "volume_ngrid": int(NGRID),
        "volume_log_min": vlo,
        "volume_log_max": vhi,
        "volume_log_mean": log_mean,
        "volume_log_median": log_median,
        "volume_encoding": (
            "uint8 log10(rho) rescaled 0..255, C-order (i,j,k), cube of side box_pc"
        ),
        "volume_colorbar": (
            "web renderer windows to [rho_0, rho_max] with rho_0 = volume-weighted "
            "mean (volume_log_mean); s = log10(rho/rho_0) drives color + opacity"
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
