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
import math
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


# --- physical constants (provenance required; see research-workflow) ----------
# Gravitational constant in [pc (km/s)^2 / Msun]. IAU 2015 nominal GM_sun
# (1.327124400e20 m^3 s^-2) divided by the parsec (3.0856775814913673e16 m),
# converted to (km/s)^2: 1.327124400e20 / 3.0856775814913673e16 / 1e6.
G_PC_KMS2_MSUN: float = 4.300917270e-3

# Cloud shape is held fixed across environments so only (M, R) and the forcing
# differ: the shipped fiducial had eff_a/r_t = 0.8/2.5 and box/r_t = 6.0/2.5.
_A_OVER_RT: float = 0.32
_BOX_OVER_RT: float = 2.4


def mach_for_alpha_vir(
    m_cloud_msun: float, radius_pc: float, c_s_km_s: float, alpha_vir: float
) -> float:
    """Turbulent Mach number placing a cloud of (M, R) at virial parameter alpha_vir.

    alpha_vir = 5 sigma_v^2 R / (G M)   -- Bertoldi & McKee (1992), ApJ 395, 140,
    the standard uniform-sphere virial parameter. Inverting for the 1-D turbulent
    velocity dispersion, sigma_v = sqrt(alpha_vir G M / (5 R)), and Mach = sigma_v/c_s.

    ML is set THIS way rather than by inverting the exported q_virial_at_sfe_ic:
    that diagnostic is the STARS' T/|W| (they inherit velocities through progenax's
    VelocitySpec), so it is a different quantity and is reported, not targeted.
    """
    sigma_v = math.sqrt(alpha_vir * G_PC_KMS2_MSUN * m_cloud_msun / (5.0 * radius_pc))
    return sigma_v / c_s_km_s


# --- one realization's parameters --------------------------------------------
@dataclass(frozen=True)
class Realization:
    """One gravoturb IC export, specified as a physical ENVIRONMENT.

    The realization axis is (m_cloud, radius): Sigma, N, v_esc and the Mach number
    all FOLLOW from it rather than being typed independently. Mach is derived by
    fixing alpha_vir (marginally bound, as observed) so no environment is left
    unphysically sub-virial -- holding Mach constant while raising the mass 50x
    would do exactly that. See docs/plans/2026-07-23-feedback-budget-design.md.
    """

    name: str
    label: str  # human label for the picker
    # --- the environment: everything below is derived from these -------------
    m_cloud: float = 2.0e4  # target cloud mass [Msun] (gas + stars at sfe)
    radius: float = 2.5  # cloud truncation radius r_t [pc]
    alpha_vir: float = 1.0  # virial parameter that SETS the Mach number
    mean_imf_mass: float = 0.3883  # <m> [Msun], measured from the shipped IMF draw
    # cloud turbulence + kinematics (mach is derived; see .mach)
    b: float = 0.5  # turbulence forcing (0.5 = natural mix)
    alpha: float = 1.8  # density-PDF/power-spectrum knob
    coupling: str = "helmholtz"
    c_s_km_s: float = 0.2
    beta_v: float = 4.0
    # cloud radial shape: truncated EFF (Elson-Fall-Freeman 1987). a and r_t are
    # DERIVED from `radius` at the shipped fiducial's fixed shape ratios, so the
    # profile is identical across environments and only the SCALE changes.
    # 3-D density slope. NOTE THE CONVENTION: this is the exponent of the
    # SPACE density, rho ~ (1 + r^2/a^2)^(-gamma/2), so gamma = 5 is Plummer.
    # Elson, Fall & Freeman (1987) ApJ 323, 54 fit the projected SURFACE
    # brightness, and Abel deprojection gives gamma_3D = gamma_surface + 1
    # (check: Plummer projects to Sigma ~ (1+R^2/a^2)^-2, i.e. 4 = 5 - 1).
    # Their 10 young LMC clusters have median gamma_surface = 2.6 over
    # 2.2 <= gamma <= 3.2, i.e. gamma_3D 3.6 spanning 3.2-4.2.
    #
    # We use the CONCENTRATED end, gamma_3D = 4.2, as the default. The physical
    # reason is epoch: EFF's clusters are gas-free and >~10 Myr old, already past
    # first expansion, whereas we model the EMBEDDED, gas-rich, pre-SN phase
    # (<~3 Myr) that precedes it. A more centrally concentrated natal profile is
    # what later relaxes toward the shallow EFF slope -- and the expansion is
    # driven partly by the gas expulsion this engine computes. 4.2 is still the
    # top of EFF's OWN observed range, so the value is citable rather than
    # invented; the epoch argument only justifies choosing the concentrated end
    # of it. (Motivated by Pfalzner 2009; Banerjee & Kroupa 2017 on post-gas-
    # expulsion expansion -- a modeling choice for the natal phase, not a settled
    # claim that EFF's slopes are purely evolutionary.)
    #
    # Concentrating the cloud concentrates its densest gas, so the density-keyed
    # segregation (lambda_corr) places the massive stars more centrally -- which
    # is the point: it makes the feedback sources less distributed, so the
    # single-effective-source analytic budget is representative of the cluster.
    eff_gamma: float = 4.2
    # sampling
    box_override: Optional[float] = None  # None -> derived from radius
    ngrid: int = 128  # gas-field grid resolution
    gas_points: int = 55000  # 3-D gas motes
    sfe: float = 0.2  # star-formation efficiency of the IC
    lambda_corr: float = 0.6  # mass<->natal-density coupling (0.6 = reference figure)
    dyn_dex: float = 6.0  # display dynamic range for the volume clamp
    # seeds (fixed across a controlled parameter axis; vary for stochastic variety)
    imf_seed: int = 9
    ic_seed: int = 1
    gaspoints_seed: int = 0
    root: bool = False  # also write to OUT_ROOT (backward compat)

    # --- derived: the environment fixes all of these -------------------------
    @property
    def mach(self) -> float:
        """Turbulent Mach number at the requested alpha_vir (never hand-set)."""
        return mach_for_alpha_vir(self.m_cloud, self.radius, self.c_s_km_s, self.alpha_vir)

    @property
    def n_stars(self) -> int:
        """N follows from the cloud: N = SFE * M_cloud / <m>."""
        return int(round(self.sfe * self.m_cloud / self.mean_imf_mass))

    @property
    def eff_rt(self) -> float:
        return self.radius

    @property
    def eff_a(self) -> float:
        return _A_OVER_RT * self.radius

    @property
    def box(self) -> float:
        return self.box_override if self.box_override is not None else _BOX_OVER_RT * self.radius

    @property
    def sigma_cloud(self) -> float:
        """Mean surface density Sigma = M/(pi R^2) [Msun/pc^2] -- the axis along
        which the feedback verdict moves (Fall, Krumholz & Matzner 2010)."""
        return self.m_cloud / (math.pi * self.radius**2)

    @property
    def v_esc(self) -> float:
        """Escape speed sqrt(2GM/R) [km/s]. Compared against the ~10 km/s sound
        speed of photoionized gas, this decides whether photoionization can drive
        material out at all, or whether the H II region is trapped."""
        return math.sqrt(2.0 * G_PC_KMS2_MSUN * self.m_cloud / self.radius)


# The v1 set: physical ENVIRONMENTS spanning the surface density at which the
# feedback verdict flips, plus a forcing (b) axis at the Orion-like point that
# varies density structure at FIXED kinetic energy and fixed alpha_vir.
#
# v_esc straddles the ~10 km/s ionized-gas sound speed by design: photoionization
# disperses the diffuse cloud, is marginal at Orion-like, and is TRAPPED in the
# massive compact one -- so the picker changes WHICH channel can do the job.
REALIZATIONS: list[Realization] = [
    Realization(
        name="diffuse", label="diffuse (low-mass)", m_cloud=2.0e3, radius=3.0
    ),
    Realization(
        name="orion", label="Orion-like", m_cloud=2.0e4, radius=2.5, root=True
    ),
    Realization(
        name="compact", label="massive compact", m_cloud=1.0e5, radius=2.0
    ),
    # forcing axis at the Orion-like environment (solenoidal -> compressive).
    # Changes density STRUCTURE at fixed kinetic energy and fixed alpha_vir.
    Realization(
        name="orion-solenoidal", label="Orion-like · solenoidal", m_cloud=2.0e4, radius=2.5, b=0.33
    ),
    Realization(
        name="orion-compressive", label="Orion-like · compressive", m_cloud=2.0e4, radius=2.5, b=1.0
    ),
    # concentration contrast at the Orion-like environment: gamma_3D = 3.2, the
    # shallow (more evolved / expanded) end of EFF's observed range, against the
    # 4.2 natal default. At fixed M, R and Mach this changes how centrally the
    # SAME mass is arranged, moving the binding energy and the local densities
    # the H II regions expand into. (A gamma_3D = 5.0 Plummer variant was tried
    # and dropped: at Mach ~13 the turbulence-dominated field places the massive
    # stars in scattered dense clumps regardless of the envelope slope, so a
    # steeper profile does not centralize the feedback sources -- it only raises
    # the binding energy, which the shallow contrast already spans.)
    Realization(
        name="orion-shallow",
        label="Orion-like · shallow (evolved) profile",
        m_cloud=2.0e4, radius=2.5, eff_gamma=3.2,
    ),
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


def _sigma_turb(rho: np.ndarray, r_t_pc: float, box_pc: float) -> float:
    """Width of the TURBULENT density PDF: sigma of ln(rho) after removing the
    spherically-averaged radial profile.

    The smooth EFF gradient is not structure that corrugates a bubble interface,
    so it must be divided out: the total sigma is dominated by the profile and
    actually FALLS as the Mach number rises, which would invert the physics if
    used directly. Only this residual rises with turbulence.

    This is the quantity the feedback ledger's leakage default reads: mixing at a
    fractal bubble/shell interface is what radiates the wind energy away
    (Lancaster, Ostriker, Kim & Kim 2021, ApJ 914, 89 & 90), and interface area
    is set by density structure, not by the Mach number directly.
    """
    n = rho.shape[0]
    c = (n - 1) / 2.0
    idx = np.arange(n) - c
    rr = np.sqrt(
        idx[:, None, None] ** 2 + idx[None, :, None] ** 2 + idx[None, None, :] ** 2
    )

    # Mask GEOMETRICALLY, to just inside the EFF truncation radius. Two wrong
    # masks were tried first and both biased the answer:
    #   rho > 0            -- admits numerically-tiny cells at the truncation
    #                         edge (ln ~ -700); gave a nonsense sigma of 83.
    #   rho > max*1e-dyn_dex -- dyn_dex is a DISPLAY range, so once the true PDF
    #                         is wider than it the low-density tail is clipped and
    #                         sigma SATURATES (~1.54 for every cloud above Mach 13,
    #                         hiding the b axis entirely).
    # Inside r_t the turbulent field is defined everywhere; outside, density is
    # truncated to zero by construction and is not turbulence at all.
    r_cells = (r_t_pc / box_pc) * n
    live = (rr < 0.95 * r_cells) & (rho > 0.0)
    lnrho = np.zeros_like(rho, dtype=np.float64)
    lnrho[live] = np.log(rho[live])
    nb = 32
    rmax = float(rr.max()) or 1.0
    bins = np.minimum(nb - 1, (rr / rmax * nb).astype(int))

    resid = np.empty(int(live.sum()), dtype=np.float64)
    k = 0
    for b in range(nb):
        sel = live & (bins == b)
        cnt = int(sel.sum())
        if cnt == 0:
            continue
        vals = lnrho[sel]
        resid[k : k + cnt] = vals - vals.mean()
        k += cnt
    return float(resid[:k].std())


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
    # Derived from the environment's radius (box/r_t held at the fiducial ratio),
    # so a bigger cloud gets a bigger box instead of being clipped by ff.BOX.
    box = float(r.box)
    dx = box / r.ngrid
    out = OUT_ROOT if r.root else OUT_ROOT / r.name
    print(
        f"[build] {r.name}: M={r.m_cloud:.3g} Msun R={r.radius} pc "
        f"-> Sigma={r.sigma_cloud:.0f} v_esc={r.v_esc:.1f} km/s "
        f"Mach={r.mach:.2f} (alpha_vir={r.alpha_vir}) b={r.b} "
        f"N={r.n_stars} box={box:.1f} grid={r.ngrid}^3 ...",
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
        "b_forcing": float(cloud.b),
        "c_s_km_s": float(velocity.c_s),
        "sfe_ic": r.sfe,
        # --- ENVIRONMENT: the axis the picker walks -------------------------
        # (m_cloud, radius) are the inputs; everything else here is DERIVED, so
        # the page never retypes a number it could compute. m_cloud_actual uses
        # the realized stellar mass rather than the target, since IMF sampling
        # scatters it slightly.
        "env_m_cloud_target_msun": float(r.m_cloud),
        "env_m_cloud_actual_msun": float(dyn["m_star_total_msun"] / r.sfe),
        "env_radius_pc": float(r.radius),
        "env_sigma_msun_pc2": float(
            (dyn["m_star_total_msun"] / r.sfe) / (math.pi * r.radius**2)
        ),
        "env_v_esc_km_s": float(
            math.sqrt(
                2.0 * G_PC_KMS2_MSUN * (dyn["m_star_total_msun"] / r.sfe) / r.radius
            )
        ),
        "env_alpha_vir_target": float(r.alpha_vir),
        "env_alpha_vir_note": (
            "alpha_vir = 5 sigma_v^2 R/(G M) (Bertoldi & McKee 1992) SETS the Mach "
            "number; q_virial_at_sfe_ic below is a DIFFERENT quantity — the stars' "
            "T/|W| — and is reported, not targeted."
        ),
        "env_v_esc_vs_c_ii_note": (
            "photoionized gas has c ~ 10 km/s: where v_esc exceeds it the H II "
            "region is trapped and photoionization cannot drive material out"
        ),
        # structure: the leakage default reads this, not the Mach number
        "sigma_turb": float(_sigma_turb(rho, r.eff_rt, box)),
        "sigma_turb_definition": (
            "sigma of ln(rho) after removing the spherically-averaged radial "
            "profile — the TURBULENT fluctuation only. The total width is "
            "dominated by the smooth EFF gradient and falls as Mach rises, so it "
            "must not be used in its place."
        ),
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
