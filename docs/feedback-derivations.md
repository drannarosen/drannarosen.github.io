# Feedback budget — full derivations

Companion to [`feedback-model.md`](./feedback-model.md), which states the model.
This file *derives* it: every step, every substitution, and — explicitly — which
quantities are **derived**, which are **interpolated from a table**, which are
**calibrated against a measurement**, and which are **estimated**.

Notation: $M$ cloud mass, $r_t$ truncation radius, $a$ EFF scale radius,
$\gamma$ EFF slope, $m(r) = M(<r)/M$, $x = r/a$, $\varrho = r_t/a$.

---

## A. Provenance of every number

| Quantity | How it is obtained |
|---|---|
| $\alpha$ (binding coeff.) | **derived** — numerical integral, §B |
| $\beta$ (escape coeff.) | **derived** — numerical integral, §C, validated against closed form |
| $\eta_{\max}$ | **derived** — Weaver similarity solution, §D, evaluated numerically |
| $f_{\rm leak}$ | **calibrated** — bisection against Lancaster+2025 $\alpha_p$, §E |
| $r_{\rm ch}$ | **derived** — pressure balance, §F; reproduces KM09's published number |
| $R(t)$, $v(t)$ H II | **analytic** — Spitzer solution, §G |
| $t_{\rm fill}$ | **derived** — inverting §G |
| $L$ per star | **exact** — Stefan–Boltzmann from exported $T_{\rm eff}$, $R$ |
| $Q$ per star | **interpolated** — Sternberg table, linear in $\log q_{\rm H}$ vs $T_{\rm eff}$ |
| $\dot M$ | **fit formula** — Björklund eq (7) / Vink eqs (24)–(25) |
| $v_\infty$ | **estimated** — a published grid-*mean* ratio applied per star, §H |
| $M_{\rm sh}$ | **interpolated** — export's tabulated $M_{\rm gas}(<r)$, linear |
| $t_{\rm MS}$ | **fit formula** — Hurley eq (5) |
| $\psi$ | **computed** from our own $L$, $S$ |
| $C_f$ | **assumed** — KM09's stated realistic value, §I |
| $f_{\rm leak,II} = 0.5$ | **assumed** — no source; a placed knob |
| $f_{\rm vent} = 0$ | **assumed** — deliberately conservative |
| $q = T/|W_\star|$ | **read from the export**, not computed here |

The two rows to be suspicious of are $v_\infty$ (§H) and $f_{\rm leak,II}$,
which is the one knob in the whole ledger with no citation behind it.

---

## B. Binding-energy coefficient $\alpha$

For a spherical mass distribution the gravitational potential energy is

$$W = -\int_0^{r_t} \frac{G M(<r)}{r}\,dM$$

Write $dM = M\,dm$ and $M(<r) = M m(r)$:

$$|W| = G M^{2}\int_0^{r_t}\frac{m(r)}{r}\,dm$$

Define $\alpha$ by $|W| \equiv \alpha\, GM^{2}/r_t$, so

$$\boxed{\ \alpha = r_t \int_0^{r_t}\frac{m}{r}\,dm\ }$$

In units where $a = 1$ (so radii are $x$ and the truncation is at $\varrho$),
this is $\alpha = \varrho\int_0^{\varrho} (m/x)\,dm$ — which is what the code
computes.

**Convergence at the origin.** For small $r$ the EFF core is flat, so
$m \sim r^{3}$ and $m/r \sim r^{2}\to 0$. The integrand is finite everywhere;
no regularisation is needed.

**Numerics.** `buildEFFCDF` returns $m$ on a 4096-point radial grid;
$\int (m/x)dm$ is accumulated by the trapezoid rule on $(m/x)$ against
$\Delta m$. Result: $\alpha = 0.976$ ($\gamma=4.2$), $0.825$ ($\gamma=3.2$).

**Sanity.** A uniform sphere gives $\alpha = 3/5$; more centrally concentrated
profiles give more, and steeper $\gamma$ gives more still. Both hold.

---

## C. Mass-weighted escape coefficient $\beta$

The potential at radius $r$ inside a truncated distribution has an interior and
an exterior contribution:

$$\Phi(r) = -G\left[\frac{M(<r)}{r} + \int_r^{r_t}\frac{dM}{r'}\right]$$

The second term is the shell theorem: mass outside $r$ contributes to the
*potential* (though not to the force). Dropping it — a common slip — would
under-count the well depth badly near the centre.

$$v_{\rm esc}(r) = \sqrt{2|\Phi(r)|}$$

Non-dimensionalise. With $a=1$ and $M=1$, define

$$\varphi(x) = \frac{m(x)}{x} + \int_x^{\varrho}\frac{dm}{x'}\,dx'$$

so that $|\Phi| = (GM/a)\,\varphi$. Converting the scale to $r_t$ via
$GM/a = (GM/r_t)\varrho$,

$$v_{\rm esc}(x) = \sqrt{2\frac{GM}{r_t}\,\varrho\,\varphi(x)}$$

Dividing by the surface value $\sqrt{2GM/r_t}$ and averaging over mass:

$$\boxed{\ \beta = \int_0^{1}\sqrt{\varrho\,\varphi(x)}\;dm\ }$$

**Normalisation check.** At $x=\varrho$: $m=1$, the outer integral vanishes, so
$\varphi = 1/\varrho$ and $\varrho\varphi = 1$. The integrand is exactly 1 at the
surface, as it must be — $\beta>1$ measures purely how much deeper the interior is.

**Numerics.** The outer integral is accumulated *inward* so each radius reuses
the tail already summed — $O(N)$ rather than $O(N^2)$. Converged: halving the
grid from 8192 to 2048 moves $\beta$ by $<10^{-3}$ (gated).

Result: $\beta = 1.383$ ($\gamma=4.2$), $1.275$ ($\gamma=3.2$).

### C.1 Closed-form validation

As $\varrho \to 0$ only the flat EFF core is retained and the cloud becomes a
**uniform sphere**, for which

$$\Phi(r) = -\frac{GM}{2R}\left(3 - \frac{r^{2}}{R^{2}}\right) \quad\Rightarrow\quad v_{\rm esc}(r) = \sqrt{\frac{GM}{R}}\sqrt{3-\frac{r^{2}}{R^{2}}}$$

At $r=R$ this is $\sqrt{2GM/R}$ ✓. With mass weight $dm = 3x^{2}dx$ on $[0,1]$:

$$\beta = \frac{1}{\sqrt2}\int_0^{1}3x^{2}\sqrt{3-x^{2}}\;dx$$

Substitute $x = \sqrt3\sin\theta$, $dx = \sqrt3\cos\theta\,d\theta$,
$\sqrt{3-x^2} = \sqrt3\cos\theta$:

$$\int 3(3\sin^{2}\theta)(\sqrt3\cos\theta)(\sqrt3\cos\theta)\,d\theta = 27\int\sin^{2}\theta\cos^{2}\theta\,d\theta = \frac{27}{4}\int\sin^{2}2\theta\,d\theta = \frac{27}{8}\int(1-\cos4\theta)\,d\theta$$

$$= \frac{27}{8}\left[\theta - \frac{\sin4\theta}{4}\right]_0^{\arcsin(1/\sqrt3)}$$

With $\theta = 0.6154797$, $\sin4\theta = 0.6285394$:

$$= 3.375\,(0.6154797 - 0.1571349) = 1.546937 \quad\Rightarrow\quad \beta = \frac{1.546937}{\sqrt2} = 1.093833$$

The code returns **1.093816** at $\varrho = 0.02$ — agreeing to $1.6\times10^{-5}$,
the residual being that $\varrho=0.02$ is small but not zero. This validates the whole
potential integral — interior term, exterior term, and the mass weighting — not
just the arithmetic.

---

## D. Wind momentum boost $\eta_{\max}$

Weaver et al. (1977) eq (21), adiabatic bubble into uniform $\rho_0$:

$$R(t) = a\left(\frac{L_w t^{3}}{\rho_0}\right)^{1/5}, \qquad a = 0.76$$

**Expansion speed.** $R \propto t^{3/5}$, so

$$v = \frac{dR}{dt} = \frac{3}{5}\,a\left(\frac{L_w}{\rho_0}\right)^{1/5}t^{-2/5} = \frac{3}{5}\frac{R}{t}$$

**Shell mass** (thin shell — all swept gas piles up at $R$):

$$M_{\rm sh} = \frac{4}{3}\pi R^{3}\rho_0$$

**Shell momentum:**

$$p_{\rm sh} = M_{\rm sh}v = \frac{4}{3}\pi R^{3}\rho_0\cdot\frac{3}{5}\frac{R}{t} = \frac{4\pi}{5}\frac{\rho_0 R^{4}}{t}$$

**Boost.** With injected $p_{\rm inj} = \dot p_w t$:

$$\eta_{\max} = \frac{p_{\rm sh}}{\dot p_w t} = \frac{4\pi}{5}\frac{\rho_0 R^{4}}{\dot p_w t^{2}}$$

Substituting $R^{4} = a^{4}(L_w t^{3}/\rho_0)^{4/5}$:

$$\eta_{\max} = \frac{4\pi}{5}\,a^{4}\,\rho_0^{1/5}L_w^{4/5}\,\frac{t^{2/5}}{\dot p_w}$$

and using $\dot p_w = \dot M v_\infty$, $L_w = \tfrac12\dot M v_\infty^{2}$
(so $\dot p_w = 2L_w/v_\infty$):

$$\boxed{\ \eta_{\max} = \frac{4\pi}{5}\frac{a^{4}}{2}\,v_\infty\left(\frac{\rho_0}{L_w}\right)^{1/5}t^{2/5}\ }$$

**Three consequences.**

1. $\eta_{\max}\propto t^{2/5}$ — it is not a constant, and any quoted value is
   meaningless without the time it was evaluated at.
2. It depends on $\rho_0$, $L_w$, $v_\infty$, so it is environment- *and*
   prescription-dependent.
3. It is evaluated **at breakout**, $t_{\rm break}$ where $R = r_{\rm cloud}$,
   obtained by inverting eq (21):
   $$t_{\rm break} = \left[\frac{(r_{\rm cloud}/a)^{5}\rho_0}{L_w}\right]^{1/3}$$
   Past breakout there is no more cloud to sweep. Evaluating at the full window
   instead inflates $\eta_{\max}$ by 3–4×.

The code evaluates $p_{\rm sh}/p_{\rm inj}$ **numerically** from $R(t_{\rm eval})$
rather than using the boxed closed form, so a change to eq (21) propagates
without anyone re-deriving. $\eta_{\max}$ is floored at 1 — the
momentum-conserving limit, below which the expression has no meaning.

**Interpolation to the real bubble:**

$$\eta = 1 + (\eta_{\max}-1)(1-f_{\rm leak})$$

Linear in $(1-f_{\rm leak})$, with both endpoints physical: $f_{\rm leak}=0$ gives
$\eta_{\max}$ (adiabatic), $f_{\rm leak}=1$ gives $\eta=1$ (momentum-conserving).
**The interpolation between them is a parameterisation, not a solution.**

---

## E. Calibrating $f_{\rm leak}$

Lancaster+2025 measure $\alpha_p$ (their eq 4, $p = \alpha_p p_{w,\rm MD}$ —
identical to our $\eta$): **4.66** and **6.20** with LyC radiation. Target is the
geometric midpoint

$$\alpha_p^{\rm target} = \sqrt{4.66\times6.20} = 5.375$$

$\eta_{\max}$ varies across environments, so no single $f_{\rm leak}$ puts them
all at the target. Let $x = 1-f_{\rm leak}$ and let $\eta_{\max}^{\rm lo}$,
$\eta_{\max}^{\rm hi}$ be the extremes over the shipped set. Solve for $x$ such
that the *geometric centre of the resulting range* hits the target:

$$\sqrt{\Big[1+(\eta_{\max}^{\rm lo}-1)x\Big]\Big[1+(\eta_{\max}^{\rm hi}-1)x\Big]} = \alpha_p^{\rm target}$$

This is a quadratic in $x$, but the code **bisects** on $x\in[0,1]$ (200
iterations) rather than solving it algebraically — the closed form is easy to get
subtly wrong and bisection cannot be.

| | $\eta_{\max}$ range | $f_{\rm leak}$ | resulting $\eta$ |
|---|---|---|---|
| Björklund | 96.2 – 149.4 | 0.963 | 4.52 – 6.49 |
| Vink | 30.4 – 71.0 | 0.905 | 3.79 – 7.65 |

**Why geometric centring and not the median.** Centring on the median
$\eta_{\max}$ put Vink's `diffuse` at $\eta = 11.6$, outside the paper's own
3–8 reference band. Centring the *range* keeps every environment inside it.

---

## F. Characteristic radius $r_{\rm ch}$

Where the two pressure terms of KM09's thin-shell equation balance.

**Radiation term** (force per unit shell area):

$$P_{\rm rad} = \frac{f_{\rm trap}L}{4\pi r^{2}c}, \qquad L = \psi S\epsilon_0$$

**Gas term.** From ionization balance (KM09 eq 2), the density of a fully
ionized sphere of radius $r$ powered by $S$:

$$\tfrac{4}{3}\pi r^{3}\alpha_B n^{2} = \phi S \quad\Rightarrow\quad n = \left(\frac{3\phi S}{4\pi\alpha_B r^{3}}\right)^{1/2}$$

and KM09 eq (3) gives the spherical gas term as $n k_B T_{\rm II}$ (coefficient
**1**; the blister case is 2):

$$P_{\rm II} = n k_B T_{\rm II} = k_BT_{\rm II}\left(\frac{3\phi S}{4\pi\alpha_B}\right)^{1/2}r^{-3/2}$$

**Balance.** Set $P_{\rm rad} = P_{\rm II}$:

$$\frac{f\psi S\epsilon_0}{4\pi r^{2}c} = k_BT\left(\frac{3\phi S}{4\pi\alpha_B}\right)^{1/2}r^{-3/2}$$

Square both sides:

$$\frac{f^{2}\psi^{2}S^{2}\epsilon_0^{2}}{16\pi^{2}r^{4}c^{2}} = k_B^{2}T^{2}\,\frac{3\phi S}{4\pi\alpha_B}\,r^{-3}$$

Multiply by $r^{4}$ and divide by $S$:

$$\frac{f^{2}\psi^{2}S\epsilon_0^{2}}{16\pi^{2}c^{2}} = k_B^{2}T^{2}\frac{3\phi}{4\pi\alpha_B}\,r$$

$$\boxed{\ r_{\rm ch} = \frac{\alpha_B}{12\pi\phi}\left(\frac{\epsilon_0}{k_BT_{\rm II}}\right)^{2}\frac{\psi^{2}f_{\rm trap}^{2}S}{c^{2}}\ }$$

which is **exactly KM09 eq (4)** for the spherical case. Their published
evaluation, $r_{\rm ch} = 9.2\times10^{-2}S_{49}$ pc at $\psi=1$,
$f_{\rm trap}=2$, is reproduced to $5\times10^{-3}$ (gated).

### F.1 The particle-count question, settled

Repeating the derivation with $P_{\rm II} = 2nk_BT$ (electrons *and* protons)
gives $\alpha_B/(48\pi\phi)$ — a factor 4 smaller in $r_{\rm ch}$. KM09's
published coefficient is $12\pi\phi$, so **their eq (4) is built on the single
count**, consistent with the explicit $(1,2)$ prefactor in their eq (3). The code
matches the paper. Whether the paper's own convention under-counts relative to a
full two-fluid treatment is a question about KM09, not about this implementation.

---

## G. H II expansion (Spitzer) and $t_{\rm fill}$

The classical D-type solution for an ionized interior at $T_{\rm II}$ driving a
shock into neutral gas:

$$R(t) = R_S\left(1+\frac{7c_{\rm II}t}{4R_S}\right)^{4/7}$$

**Speed** — differentiate directly. Let $u = 1 + 7c_{\rm II}t/(4R_S)$, so
$du/dt = 7c_{\rm II}/(4R_S)$:

$$\frac{dR}{dt} = R_S\cdot\frac{4}{7}u^{-3/7}\cdot\frac{7c_{\rm II}}{4R_S} = c_{\rm II}\,u^{-3/7}$$

So $v(0) = c_{\rm II}$ and $v \to 0$ as $t\to\infty$ — the front starts at the
ionized sound speed and decelerates as $t^{-3/7}$.

**Momentum scaling.** With $M_{\rm sh}\propto R^{3}$ at fixed density,

$$p \propto R^{3}v \propto t^{12/7}\cdot t^{-3/7} = t^{9/7}$$

**super-linear**, which is why the H II curve is recomputed at every sample
rather than scaled from its endpoint like the two linear channels. (In the
shipped model $M_{\rm sh}$ comes from the enclosed-mass profile rather than
$\rho R^3$, so the exponent is only asymptotic.)

**Fill time.** Setting $R(t) = r_{\rm cloud}$:

$$\left(\frac{r_{\rm cloud}}{R_S}\right)^{7/4} = 1+\frac{7c_{\rm II}t}{4R_S} \quad\Rightarrow\quad \boxed{\ t_{\rm fill} = \frac{4R_S}{7c_{\rm II}}\left[\left(\frac{r_{\rm cloud}}{R_S}\right)^{7/4}-1\right]}$$

Past $t_{\rm fill}$ the region is frozen: evaluated at $t_{\rm fill}$, not at $t$.
The shell gains no more mass and no more momentum, but loses none either.

---

## H. Wind terminal velocity — the weakest step

$$\Gamma_e = \frac{L\sigma_e}{4\pi cGM}, \qquad \sigma_e = 0.2(1+X)\ {\rm cm^2/g}$$

Numerically, $L_\odot/(4\pi cGM_\odot) = 7.654\times10^{-5}$ per cm²/g, giving
Vink's eq (11) coefficient $7.66\times10^{-5}$ ✓.

$$v_{\rm esc,eff} = \sqrt{\frac{2GM(1-\Gamma_e)}{R}}, \qquad v_\infty = \kappa\,v_{\rm esc,eff}$$

**This is an estimate, not a derivation.** Björklund publish no $v_\infty(M,R,L)$
law — only a grid *mean* ratio $\kappa = 4.5$ (their sec 5.1, alongside a grid
mean speed of ~3300 km/s). Applying a population mean per star carries the $M$–$R$
dependence through $v_{\rm esc,eff}$, which is the right scaling (CAK ties
$v_\infty$ to the effective escape speed), but it is our composition and not
their result.

**And the composition crosses model rungs.** Their grid is built on MESA
*evolutionary tracks*; we apply $\kappa$ to *ZAMS* Tout radii, which are more
compact. Measured:

| | mean $v_{\rm esc,eff}$ | mean $v_\infty$ |
|---|---|---|
| Björklund grid (implied) | 733 km/s | ~3300 km/s |
| this engine | 1137–1151 km/s | 5115–5180 km/s |

$1.55\times$ high in speed, so $\sim2.4\times$ in wind *energy* ($\propto v^2$).
The paper already flags its own 3300 km/s as "not generally found in the
observational literature". **This is the largest un-fixed systematic in the wind
channel**, and it is not fixable without inventing a law the paper does not give.

---

## I. Trapping factor

$$f_{\rm trap} = C_f + f_{\rm trap,IR} + f_{\rm trap,Ly\alpha}$$

**Why the direct term is $C_f$.** KM09's own energy balance for a porous shell,
their eq (35):

$$L = \underbrace{(1-C_f)L}_{\text{escapes without interacting}} + \;3\pi r_{\rm II}^{2}(1-C_f)P_{\rm IR}$$

Radiation that never interacts deposits no momentum, so only the fraction $C_f$
contributes to the direct term. Writing 1 asserts $C_f = 1$: a shell subtending
the entire sky.

$C_f = 0.5$ is **assumed**, taking KM09's "realistic values of
$C_f\lesssim1/2$"; it is also the geometric ceiling for a blister region.

**IR term** — KM09 eq (34), a fit to a diffusion calculation, *not* an opacity:

$$f_{\rm trap,IR} = \left[\Sigma_{\rm sh}^{-3}\left(\frac{132}{T_{\rm eff,sh}}\right)^{6} + \Sigma_{\rm sh}^{-1.92}\left(\frac{72}{T_{\rm eff,sh}}\right)^{1.71}\right]^{-2/3}$$

with the shell photosphere temperature from $4\pi r^{2}\sigma_{\rm SB}T^{4} = L$:

$$T_{\rm eff,sh} = \left(\frac{L}{4\pi r^{2}\sigma_{\rm SB}}\right)^{1/4} \propto \left(\frac{L}{r^{2}}\right)^{1/4}$$

so IR trapping tracks **compactness**, not mass. The coefficients 132, 72, $-3$,
$-1.92$, $-2/3$ encode a specific dust model's $\kappa(T)$; substituting another
model's opacity into them would be meaningless.

$\Sigma_{\rm sh} = M_{\rm sh}/(4\pi r^{2})$ is taken with $M_{\rm sh} = M_{\rm cloud}$
at $r_{\rm cloud}$ — the **generous** bound, since the real shell has swept only
part of the cloud. So the resulting trapping is an over-estimate of an expression
that is already an upper limit.

---

## J. Integration over the window

Winds and radiation inject at constant rates while the stars sit on the main
sequence, so their integrals are trivial:

$$p_w = \eta\,(1-f_{\rm vent})\,\dot p_w\,t_{\rm win}, \qquad E_w = (1-f_{\rm leak})\,\dot E_w\,t_{\rm win}$$

$$p_{\rm rad} = f_{\rm trap}\frac{L}{c}t_{\rm win}, \qquad E_{\rm rad} = 0$$

Radiation contributes **no energy** to the ledger: it deposits momentum, not
thermal energy, into the cloud.

Photoionization is *not* linear and is re-evaluated at each of 60 samples.

**Thresholds:**

$$\frac{p_{\rm total}}{M_{\rm gas}\,\beta\sqrt{2GM/r_t}} \ge 1 \quad\text{(stage 1)}, \qquad \frac{E_{\rm total}}{\alpha GM^{2}/r_t} \ge 1 \quad\text{(energy bar)}$$

$t_{\rm remove}$ is obtained by **linear interpolation between the two trajectory
samples that bracket the crossing** — not from $t_{\rm win}/{\rm ratio}$, which
assumes linear accumulation and is wrong by up to 31% because of the $t^{9/7}$
H II term.

---

## K. Interpolation schemes

| Table | Scheme | Outside range |
|---|---|---|
| Sternberg $q_{\rm H}(T_{\rm eff})$ | linear in $\log q_{\rm H}$ vs $T_{\rm eff}$ | $Q=0$ below 32,060 K; top row held above 51,230 K |
| $M_{\rm gas}(<r)$ | linear in $r$, 1024 samples | clamped to $M_{\rm gas}$ beyond $r_{\max}$ |
| EFF CDF | 4096-point grid, trapezoid | — |
| Björklund / Vink $\dot M$ | none — closed-form fits | $\dot M = 0$ outside the validity box, counted |

Nothing is extrapolated. Every out-of-range star is counted and reported
(`nOutOfRange`), because a recipe silently summing over a subset is how a budget
comes out confident and wrong.

---

## L. What is *not* modelled

- No equation of motion for the gas — this is a ledger, not a hydro run.
- No channel coupling: the three are summed as if independent.
- No stellar evolution within the window; no supernovae (the window ends there).
- No magnetic fields, no cosmic rays, no dust drift.
- Geometry is spherical throughout; the blister case exists but is unused.
- The cloud potential is static — it does not respond as gas leaves.
- Stage 2 is read from the export, so it responds to nothing on the page.
