import numpy as np, json
from astropy.visualization import make_lupton_rgb

rng = np.random.default_rng(20260725)
cases = []
# A spread of regimes: sky, faint, mid, saturated, strongly coloured, and negatives.
triples = [
    (0.0, 0.0, 0.0), (1e-4, 1e-4, 1e-4), (0.01, 0.02, 0.04),
    (0.5, 0.3, 0.1), (1.0, 1.0, 1.0), (5.0, 2.0, 0.5),
    (50.0, 20.0, 5.0), (1000.0, 10.0, 1.0), (0.1, 0.0, 0.0),
    (-0.05, 0.2, 0.4), (3.0, 3.0, 3.0), (0.001, 0.5, 2.0),
]
for _ in range(28):
    triples.append(tuple(float(x) for x in 10 ** rng.uniform(-4, 3, 3)))

for stretch, Q in [(5, 8), (5, 0), (1, 8), (20, 3), (0.5, 30), (5, 100)]:
    for (r, g, b) in triples:
        # 1x1 images so we exercise the exact per-pixel path
        R = np.array([[r]], dtype=np.float64)
        G = np.array([[g]], dtype=np.float64)
        B = np.array([[b]], dtype=np.float64)
        out = make_lupton_rgb(R, G, B, minimum=0, stretch=stretch, Q=Q)
        cases.append({"r": r, "g": g, "b": b, "stretch": stretch, "Q": Q,
                      "out": [int(out[0, 0, 0]), int(out[0, 0, 1]), int(out[0, 0, 2])]})

# per-band minima, which astropy supports as a 3-vector
for (r, g, b) in triples[:12]:
    mins = [0.001, 0.002, 0.003]
    R = np.array([[r]]); G = np.array([[g]]); B = np.array([[b]])
    out = make_lupton_rgb(R, G, B, minimum=mins, stretch=5, Q=8)
    cases.append({"r": r, "g": g, "b": b, "stretch": 5, "Q": 8, "minimum": mins,
                  "out": [int(out[0,0,0]), int(out[0,0,1]), int(out[0,0,2])]})

print(json.dumps({"astropy": __import__("astropy").__version__, "cases": cases}, indent=1))
