"""gen-extinction-ref.py — record what fluxax's extinction curves produce, once.

`core/extinction` is a PORT. Its coefficients were transcribed from fluxax's
`photometry/extinction/laws.py`, whose own coefficients trace to a primary-source-verified
equation digest. So the question this fixture answers is not "is the arithmetic
self-consistent" — it is "did the transcription land", and the only way to answer that is to
compare against the thing it was transcribed from, in the language it was transcribed from.

Same shape as `check-lupton` (validates against astropy) and `check-imf` (pins Maschberger to a
progenax fixture): the reference is another implementation, not a self-generated expectation.

WHY THIS MATTERS CONCRETELY. While teeth-testing the TypeScript tests, two CCM89 coefficients
were corrupted at once and the property tests caught it — but only because the corruptions were
large. A last-digit change (0.72085 -> 0.72086) passed all twenty. A numerical fixture at 1e-10
catches every one of them, and does not depend on anyone's assertions being sensitive enough.

ONE DELIBERATE DIVERGENCE IS RECORDED RATHER THAN HIDDEN. fluxax's CCM89 has no domain guard:
above x = 3.3 it keeps evaluating the optical polynomial, which is correct for fluxax (its bands
stop at x <= 3.33) and wrong here (HST F275W sits at x = 3.69). novascope returns NaN there
instead. The `ccm89_out_of_domain` block records fluxax's value at those points so the gate can
assert the divergence is exactly where it is meant to be — a divergence nobody wrote down is a
bug waiting to be "fixed".

Usage, from the fluxax checkout (it needs fluxax's own environment):

    cd ~/projects/jaxstro-dev/fluxax
    uv run python ~/projects/drannarosen.github.io/scripts/reference/gen-extinction-ref.py
"""

from __future__ import annotations

import json
import pathlib

import numpy as np

from fluxax.photometry.extinction.laws import ccm89_a_over_av, g23_a_over_av

OUT = pathlib.Path.home() / "projects/drannarosen.github.io/scripts/fixtures/extinction-fluxax.json"

# R_V values spanning G23's fitted range [2.3, 5.6], including the 3.1 Milky Way pivot.
R_V_VALUES = [2.3, 2.5, 3.1, 4.0, 5.5, 5.6]

# The effective wavelengths of every passband this repo ships, so the fixture covers exactly
# what the renderer will ask for, not only a synthetic grid.
BAND_NM = [
    270.8, 360.0, 361.8, 372.4, 441.0, 471.8, 480.7, 518.3, 552.4, 596.0,
    618.7, 622.1, 639.0, 646.9, 750.6, 755.9, 782.5, 788.6, 807.3, 868.0,
    891.8, 904.2, 975.3, 1241.0, 1539.2, 1651.3, 1993.4, 2165.6, 4416.0, 7663.4,
]

# CCM89's implemented domain: 0.3 <= x <= 3.3 um^-1.
CCM89_MIN_NM, CCM89_MAX_NM = 1000 / 3.3, 1000 / 0.3
# G23's published validity: 912 A to 32 um.
G23_MIN_NM, G23_MAX_NM = 91.2, 32_000.0


def grid(lo: float, hi: float, n: int) -> list[float]:
    """Log-spaced sample points, kept strictly inside the endpoints."""
    return list(np.geomspace(lo * 1.0001, hi * 0.9999, n))


def rows(fn, wavelengths: list[float]) -> list[dict]:
    out = []
    for rv in R_V_VALUES:
        lam = np.asarray(wavelengths, dtype=np.float64)
        vals = np.asarray(fn(lam, R_V=rv), dtype=np.float64)
        out.append({"rv": rv, "aOverAv": [float(v) for v in vals]})
    return out


ccm89_nm = sorted(set(grid(CCM89_MIN_NM, CCM89_MAX_NM, 60) +
                      [b for b in BAND_NM if CCM89_MIN_NM <= b <= CCM89_MAX_NM]))
g23_nm = sorted(set(grid(G23_MIN_NM, G23_MAX_NM, 80) + BAND_NM))

# Points where novascope returns NaN and fluxax does not — recorded so the gate can prove the
# divergence sits exactly at the three bands outside CCM89's implemented branches.
out_of_domain_nm = [b for b in BAND_NM if not (CCM89_MIN_NM <= b <= CCM89_MAX_NM)]

doc = {
    "generatedBy": "scripts/reference/gen-extinction-ref.py",
    "reference": "fluxax photometry/extinction/laws.py (Apache 2.0)",
    "papers": {
        "ccm89": "Cardelli, Clayton & Mathis (1989), ApJ 345, 245",
        "g23": "Gordon et al. (2023), ApJ 950, 86",
    },
    "rvValues": R_V_VALUES,
    "ccm89": {"lambdaNm": ccm89_nm, "runs": rows(ccm89_a_over_av, ccm89_nm)},
    "g23": {"lambdaNm": g23_nm, "runs": rows(g23_a_over_av, g23_nm)},
    "ccm89OutOfDomain": {
        "lambdaNm": out_of_domain_nm,
        "note": (
            "fluxax returns these; novascope returns NaN. fluxax has no UV branch and no domain "
            "guard, which is correct for its band set (x <= 3.33) and wrong for this one."
        ),
        "fluxaxAOverAv": [
            float(ccm89_a_over_av(np.array([nm]), R_V=3.1)[0]) for nm in out_of_domain_nm
        ],
    },
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(doc, indent=2) + "\n")
print(f"wrote {OUT}")
print(f"  ccm89: {len(ccm89_nm)} wavelengths x {len(R_V_VALUES)} R_V")
print(f"  g23:   {len(g23_nm)} wavelengths x {len(R_V_VALUES)} R_V")
print(f"  out-of-domain points recorded: {len(out_of_domain_nm)}")
