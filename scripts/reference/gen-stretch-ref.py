# Generated reference for check:stretch. Authority: astropy.visualization (public repo).
"""Generate stretch reference values from astropy itself — see check-stretch.mjs."""
import numpy as np, json, astropy
from astropy.visualization import (LinearStretch, SqrtStretch, AsinhStretch,
                                   LogStretch, SinhStretch)

CURVES = {
    "linear": LinearStretch(),
    "sqrt":   SqrtStretch(),
    "asinh":  AsinhStretch(),      # a=0.1 default
    "log":    LogStretch(),        # a=1000 default
    "sinh":   SinhStretch(),       # a=0.333 default
}
xs = list(np.linspace(0.0, 1.0, 41)) + [1e-6, 1e-4, 1e-3, 0.005, 0.02, 0.333, 0.995]
xs = sorted(set(float(x) for x in xs))
out = {"astropyVersion": astropy.__version__, "x": xs, "curves": {}}
for name, c in CURVES.items():
    vals = c(np.array(xs, dtype=np.float64), clip=True)
    out["curves"][name] = [float(v) for v in vals]
print(json.dumps(out))
