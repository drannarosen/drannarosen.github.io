#!/usr/bin/env python
"""Export progenax gravoturb cluster ICs to web-ready data for drannarosen.github.io.

A thin BRIDGE: Anna's progenax `gravoturb` model is the source of truth. This
script builds one or more initial-condition realizations via
`feasibility_figure.build_cluster_ic` and writes flat float32/uint8 arrays the
website reads directly. It performs no physics of its own.

Each realization is a `Realization` config (seeds + cloud/geometry/velocity
knobs). The set in REALIZATIONS below is the shipped one; edit it, or pass
`--only <name>`. Every realization writes to its own folder under
public/data/gravoturb/ plus a top-level manifest.json the engine's picker reads.
The `root=True` realization also writes to the folder root, so the existing
Birth / Gas-expulsion pages (which load /data/gravoturb/) keep working unchanged.

--------------------------------------------------------------------------------
Run it (from the website repo root), pointing at Anna's jaxstro checkout:

  JAXSTRO=$HOME/projects/jaxstro-dev
  PYTHONPATH="$JAXSTRO/progenax/src/experimental:$JAXSTRO/progenax/src" \
    "$JAXSTRO/progenax/.venv/bin/python" scripts/gravoturb/export_cluster.py

Override the checkout location with the JAXSTRO env var if it lives elsewhere.
--------------------------------------------------------------------------------

Per-realization outputs (public/data/gravoturb/<name>/, or the root for root=True):
  stars.f32      N x [x, y, z, mass, teff, radius]  (pc, pc, pc, Msun, K, Rsun)
  velocities.f32 N x [vx, vy, vz]                    (pc/Myr, COM frame pinned)
  local_density.f32  N x rho at each star's cell     (Msun/pc^3)
  gas.f32        NGRID x NGRID  log10 projected surface density (Msun/pc^2)
  gas_points.u8  M x [i, j, k, dens]                 (grid indices + log-scaled byte)
  volume.u8      NGRID^3  uint8 log10(rho), C-order  (for WebGL raymarching)
  gas_menc.f32   tabulated M_gas(<r)/M_gas on a uniform radial grid
  meta.json      shapes, ranges, extents, provenance (all read back from the specs)
Top level:
  manifest.json  the realization set (name, label, path, key diagnostics) for the picker
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional

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

OUT_ROOT = Path(__file__).resolve().parents[2] / "public" / "data" / "gravoturb"


# --- one realization's parameters --------------------------------------------
@dataclass(frozen=True)
class Realization:
    """Everything that defines one gravoturb IC export. Defaults are the shipped
    fiducial (byte-identical to the original single-shot script)."""

    name: str
    label: str  # human label for the picker
    # cloud turbulence + kinematics
    mach: float = 8.0
    b: float = 0.5  # turbulence forcing (0.5 = natural mix)
    alpha: float = 1.8  # density-PDF/power-spectrum knob
    coupling: str = "helmholtz"
    c_s_km_s: float = 0.2
    beta_v: float = 4.0
    # cloud radial shape: truncated EFF (Elson-Fall-Freeman 1987)
    eff_a: float = 0.8  # core scale radius [pc]
    eff_gamma: float = 3.0  # 3-D density slope (~3 young cluster; 5 = Plummer)
    eff_rt: float = 2.5  # truncation radius [pc] (box half-width is 3.0)
    # sampling
    box: Optional[float] = None  # None -> ff.BOX (model's own box)
    ngrid: int = 128  # gas-field grid resolution
    n_stars: int = 10000
    gas_points: int = 55000  # 3-D gas motes
    sfe: float = 0.2  # star-formation efficiency of the IC
    lambda_corr: float = 0.6  # mass<->natal-density coupling (0.6 = reference figure)
    dyn_dex: float = 6.0  # display dynamic range for the volume clamp
    # seeds (fixed across a controlled parameter axis; vary for stochastic variety)
    imf_seed: int = 9
    ic_seed: int = 1
    gaspoints_seed: int = 0
    root: bool = False  # also write to OUT_ROOT (backward compat)


# The shipped v1 set: a controlled Mach ladder, seeds fixed so only the
# turbulence differs (calm -> filamentary). Mach-8 is the backward-compat root.
REALIZATIONS: list[Realization] = [
    Realization(name="calm", label="calm (Mach 4)", mach=4.0),
    Realization(name="fiducial", label="fiducial (Mach 8)", mach=8.0, root=True),
    Realization(name="turbulent", label="turbulent (Mach 12)", mach=12.0),
]


# --- pure export helpers (given the built IC + realization) -------------------
def _volume_u8(rho: np.ndarray, dyn_dex: float) -> dict:
    """3-D density VOLUME (uint8, log-scaled) for WebGL raymarching. The real
    EFF-truncated field as-is (rho=0 beyond r_t, so the cloud is physically round
    with NO geometric masking). Clamp the display range to dyn_dex below the peak
    (standard imshow vmin/vmax); the truncated exterior clamps to byte 0."""
    vhi = float(np.log10(rho.max()))
    vlo = vhi - dyn_dex
    floor_rho = 10.0 ** vlo
    vlog = np.log10(np.clip(rho, floor_rho, None))
    vol = (np.clip((vlog - vlo) / (vhi - vlo), 0.0, 1.0) * 255.0).astype(np.uint8)
    disp = rho > floor_rho  # displayed cloud, for the colorbar anchors
    return {
        "vol_u8": vol,
        "vlo": vlo,
        "vhi": vhi,
        "log_mean": float(np.log10(rho[disp].mean())),
        "log_median": float(np.log10(np.median(rho[disp]))),
    }


def _gas_projection(rho: np.ndarray, cell_volume: float, dx: float) -> np.ndarray:
    """2-D projected surface density (log10) — line-of-sight sum of the real field."""
    col = rho.sum(axis=2) * cell_volume / dx**2  # Msun / pc^2
    cfloor = float(col.max()) * 1e-4  # sane projected floor (exterior columns ~0)
    return np.log10(np.maximum(col, cfloor)).astype(np.float32)


def _gas_points(rho: np.ndarray, n_points: int, seed: int) -> np.ndarray:
    """3-D gas motes tracing the filaments. Sample cells ∝ rho^0.55 (not rho) so
    motes spread into the diffuse gas instead of cramming into the core; the
    per-mote value still carries the TRUE density for brightness/size."""
    rng = np.random.default_rng(seed)
    flat = rho.reshape(-1)
    wsamp = np.power(flat, 0.55)
    idx = rng.choice(flat.size, size=n_points, replace=True, p=wsamp / wsamp.sum())
    ijk = np.stack(np.unravel_index(idx, rho.shape), axis=1).astype(np.uint8)
    dpt = flat[idx]
    dpt_log = np.log10(np.maximum(dpt, dpt[dpt > 0].min()))
    dq = ((dpt_log - dpt_log.min()) / np.ptp(dpt_log) * 255).astype(np.uint8)
    return np.column_stack([ijk, dq]).astype(np.uint8)  # (n, 4): i, j, k, dens


def _stars(ic, box: float) -> dict:
    """Real 3-D positions (box-centered) + ZAMS teff/radius from the masses. Stars
    map to gas cell (pos+origin)/box*ngrid, so place them in that frame and
    recenter on the box middle — keeps them registered over the gas field."""
    pos = np.asarray(ic.stars.positions)  # (N, 3) pc
    mass = np.asarray(ic.stars.masses)  # (N,) Msun
    origin = np.asarray(ic.ledger.frame.origin)  # (3,)
    xyz = (pos + origin[:3]) - (box / 2.0)  # pc, cluster/box centered
    m_clip = jnp.clip(jnp.asarray(mass), 0.08, 150.0)
    teff = np.asarray(zams_effective_temperature(m_clip), dtype=np.float32)
    radius = np.asarray(zams_radius(m_clip), dtype=np.float32)
    stars = np.column_stack(
        [xyz[:, 0], xyz[:, 1], xyz[:, 2], mass, teff, radius]
    ).astype(np.float32)
    return {"stars": stars, "xyz": xyz, "mass": mass, "teff": teff, "radius": radius,
            "pos": pos, "origin": origin}


def _gas_menc(eff: EFFProfile, r_grid: np.ndarray) -> np.ndarray:
    """M_gas(<r)/M_gas tabulated from THIS model's own EFF profile (integrate
    rho(r) 4 pi r^2 dr, normalize) so the browser never re-derives EFF in TS."""
    rho_r = np.asarray(eff.density(jnp.asarray(r_grid)))
    shell = rho_r * 4.0 * np.pi * r_grid**2
    m_of_r = np.concatenate(
        [[0.0], np.cumsum(np.diff(r_grid) * 0.5 * (shell[1:] + shell[:-1]))]
    )
    return (m_of_r / m_of_r[-1]).astype(np.float32)


def _velocities(ic, mass: np.ndarray) -> np.ndarray:
    """The REAL turbulent kinematics: stars sample the same Helmholtz-coupled GRF
    that sculpted the density, so kinematics and structure are consistent. The
    dispersion is EMERGENT (sigma_g = mach*c_s), not virial-scaled, and does not
    depend on the SFE. Pin the COM frame exactly."""
    vel = np.asarray(ic.stars.velocities)  # (N, 3) pc/Myr
    bulk = (mass[:, None] * vel).sum(axis=0) / mass.sum()
    return (vel - bulk).astype(np.float32)


def _local_density(ic, rho: np.ndarray, box: float, ngrid: int) -> np.ndarray:
    """rho at each star's grid cell — the coupling key mass segregation re-pairs
    on, and the local n a per-star Strömgren radius needs."""
    pos = np.asarray(ic.stars.positions)
    origin = np.asarray(ic.ledger.frame.origin)
    cell = np.clip(np.floor((pos + origin[:3]) / box * ngrid).astype(int), 0, ngrid - 1)
    return rho[cell[:, 0], cell[:, 1], cell[:, 2]].astype(np.float32)


def _diagnostics(xyz, mass, vel, gas_menc_frac, r_grid, sfe, G) -> dict:
    """Dynamical diagnostics the web integrator + the ledger need. Virial ratio Q
    uses the spherical enclosed-mass approximation the page also integrates, so
    the reported number matches the integrated one."""
    m_star_total = float(mass.sum())
    r = np.linalg.norm(xyz, axis=1)
    order = np.argsort(r)
    m_cum = np.cumsum(mass[order])
    r_half = float(r[order][np.searchsorted(m_cum, 0.5 * m_star_total)])
    sigma_3d = float(np.sqrt((mass * (vel**2).sum(axis=1)).sum() / m_star_total))
    t_cross = 2.0 * r_half / sigma_3d
    m_gas_ic = m_star_total * (1.0 - sfe) / sfe
    m_gas_enc = np.interp(r[order], r_grid, gas_menc_frac) * m_gas_ic
    m_enc = m_cum + m_gas_enc
    w_energy = -G * float(np.sum(mass[order] * m_enc / np.maximum(r[order], 1e-6)))
    t_energy = 0.5 * float((mass * (vel**2).sum(axis=1)).sum())
    return {
        "m_star_total_msun": m_star_total,
        "r_half_pc": r_half,
        "sigma_3d_pc_myr": sigma_3d,
        "t_cross_myr": t_cross,
        "q_virial_at_sfe_ic": t_energy / abs(w_energy),
    }


# --- build one realization ---------------------------------------------------
def build_one(r: Realization) -> dict:
    box = float(ff.BOX) if r.box is None else r.box
    dx = box / r.ngrid
    out = OUT_ROOT if r.root else OUT_ROOT / r.name
    print(
        f"[build] {r.name}: Mach={r.mach} EFF a={r.eff_a} gamma={r.eff_gamma} "
        f"r_t={r.eff_rt}  lambda_corr={r.lambda_corr}  N={r.n_stars} grid={r.ngrid}^3 ...",
        flush=True,
    )

    # Build the IC — keep the spec objects so meta reads back FROM them (DRY).
    cloud = ff.CloudSpec(mach=r.mach, b=r.b, alpha=r.alpha, beta=None, coupling=r.coupling)
    geometry = ff.GeometrySpec(
        profile=EFFProfile(a=r.eff_a, gamma=r.eff_gamma, r_t=r.eff_rt),
        box_size=box,
        shape=(r.ngrid,) * 3,
    )
    velocity = ff.VelocitySpec(beta_v=r.beta_v, mode="physical", c_s=r.c_s_km_s)
    composition = ff.CompositionSpec(lambda_corr=r.lambda_corr)
    masses = ff.IMF.sample(jax.random.PRNGKey(r.imf_seed), r.n_stars)
    ic = ff.build_cluster_ic(
        masses,
        cloud=cloud,
        geometry=geometry,
        velocity=velocity,
        composition=composition,
        G=ff.G,
        units=ff.STELLAR,
        key=jax.random.PRNGKey(r.ic_seed),
        gas=ff.GasSpec(sfe=r.sfe),
    )

    rho = np.asarray(ic.gas.rho_cloud)  # (NGRID, NGRID, NGRID)
    cell_volume = float(ic.gas.cell_volume)
    r_menc = np.linspace(0.0, box * 0.5 * np.sqrt(3.0), 1024)

    vol = _volume_u8(rho, r.dyn_dex)
    gas_log = _gas_projection(rho, cell_volume, dx)
    gas_points = _gas_points(rho, r.gas_points, r.gaspoints_seed)
    st = _stars(ic, box)
    gas_menc_frac = _gas_menc(geometry.profile, r_menc)
    vel = _velocities(ic, st["mass"])
    local_density = _local_density(ic, rho, box, r.ngrid)
    dyn = _diagnostics(st["xyz"], st["mass"], vel, gas_menc_frac, r_menc, r.sfe, float(ff.G))

    out.mkdir(parents=True, exist_ok=True)
    st["stars"].tofile(out / "stars.f32")
    vel.tofile(out / "velocities.f32")
    gas_menc_frac.tofile(out / "gas_menc.f32")
    local_density.tofile(out / "local_density.f32")
    gas_log.tofile(out / "gas.f32")
    gas_points.tofile(out / "gas_points.u8")
    vol["vol_u8"].tofile(out / "volume.u8")

    meta = {
        "provenance": "progenax gravoturb build_cluster_ic (EFF truncated cloud)",
        "cloud_profile": "EFF (Elson-Fall-Freeman 1987), truncated at r_t",
        "realization": r.name,
        "label": r.label,
        "eff_a_pc": r.eff_a,
        "eff_gamma": r.eff_gamma,
        "eff_r_t_pc": r.eff_rt,
        "lambda_corr": composition.lambda_corr,
        "n_stars": int(st["stars"].shape[0]),
        "star_fields": ["x", "y", "z", "mass", "teff", "radius"],
        "star_units": ["pc", "pc", "pc", "Msun", "K", "Rsun"],
        "velocity_fields": ["vx", "vy", "vz"],
        "velocity_units": "pc/Myr",
        "velocity_origin": (
            "progenax VelocitySpec(mode='physical'): the velocity GRF is normalized "
            "so its volume-weighted rms is sigma_g = mach*c_s, and stars sample it "
            "(x eta_v). The stellar dispersion is EMERGENT, not virial-scaled, and "
            "is independent of the star-formation efficiency. COM frame pinned."
        ),
        # read back from the specs — single source of truth, no double-typing
        "mach": float(cloud.mach),
        "c_s_km_s": float(velocity.c_s),
        "sfe_ic": r.sfe,
        "G_pc3_msun_myr2": float(ff.G),
        **dyn,
        "gas_menc_n": int(gas_menc_frac.size),
        "gas_menc_r_max_pc": float(r_menc[-1]),
        "gas_menc_encoding": (
            "float32 M_gas(<r)/M_gas on a uniform radial grid r = "
            "linspace(0, gas_menc_r_max_pc, gas_menc_n); truncated-EFF profile "
            "integrated as rho(r) 4 pi r^2 dr, saturates at 1 by r_t"
        ),
        "ngrid": int(r.ngrid),
        "box_pc": float(box),
        "gas_log_min": float(gas_log.min()),
        "gas_log_max": float(gas_log.max()),
        "gas_field": "log10(Sigma_cl / [Msun pc^-2]), row-major NGRID x NGRID",
        "n_gas_points": int(gas_points.shape[0]),
        "gas_point_fields": ["i", "j", "k", "dens"],
        "gas_point_encoding": (
            "uint8: i,j,k grid indices 0..NGRID-1 "
            "(pc = (idx+0.5)/NGRID*box - box/2); dens log-scaled 0..255"
        ),
        "volume_ngrid": int(r.ngrid),
        "volume_log_min": vol["vlo"],
        "volume_log_max": vol["vhi"],
        "volume_log_mean": vol["log_mean"],
        "volume_log_median": vol["log_median"],
        "volume_encoding": (
            "uint8 log10(rho) rescaled 0..255, C-order (i,j,k), cube of side box_pc"
        ),
        "volume_colorbar": (
            "web renderer windows to [rho_0, rho_max] with rho_0 = volume-weighted "
            "mean (volume_log_mean); s = log10(rho/rho_0) drives color + opacity"
        ),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    print(
        f"[ok] {r.name}: N={meta['n_stars']} M*={dyn['m_star_total_msun']:.0f} Msun "
        f"r_h={dyn['r_half_pc']:.3f} pc sigma={dyn['sigma_3d_pc_myr']:.3f} pc/Myr "
        f"Q={dyn['q_virial_at_sfe_ic']:.3f} -> {out.relative_to(OUT_ROOT.parents[1])}",
        flush=True,
    )
    web_path = "/data/gravoturb" if r.root else f"/data/gravoturb/{r.name}"
    return {
        "name": r.name,
        "label": r.label,
        "path": web_path,
        "mach": float(cloud.mach),
        "n_stars": meta["n_stars"],
        "m_star_total_msun": dyn["m_star_total_msun"],
        "r_half_pc": dyn["r_half_pc"],
        "q_virial_at_sfe_ic": dyn["q_virial_at_sfe_ic"],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Export progenax gravoturb realizations.")
    ap.add_argument("--only", help="build only the realization with this name")
    args = ap.parse_args()

    to_build = REALIZATIONS
    if args.only:
        to_build = [r for r in REALIZATIONS if r.name == args.only]
        if not to_build:
            sys.exit(f"no realization named {args.only!r} in REALIZATIONS")

    entries = [build_one(r) for r in to_build]

    # Merge into the manifest (so --only updates a single entry in place).
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT_ROOT / "manifest.json"
    existing = {}
    if manifest_path.exists() and args.only:
        for e in json.loads(manifest_path.read_text()).get("realizations", []):
            existing[e["name"]] = e
    for e in entries:
        existing[e["name"]] = e
    ordered = [existing[r.name] for r in REALIZATIONS if r.name in existing]
    manifest = {"generated_by": "scripts/gravoturb/export_cluster.py", "realizations": ordered}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"[done] {len(entries)} realization(s); manifest -> {manifest_path}")


if __name__ == "__main__":
    main()
