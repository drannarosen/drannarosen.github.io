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

---

## M. Coupling the shell's porosity across channels

$C_f$, $f_{\rm vent}$ and $f_{\rm leak,w}$ are not independent. They are three
consequences of one physical structure — how full of holes the swept shell is —
and KM09 use **the same $C_f$** for the radiation term and for the hot wind gas.

The shipped defaults were mutually inconsistent:

| knob | value | asserts |
|---|---|---|
| $C_f$ | 0.5 | half the sky is holes |
| $f_{\rm vent}$ | 0 | **no hot gas escapes** |

i.e. half the sky open to photons and sealed to the wind. Two couplings are
implemented, selectable, with `independent` retained as the historical baseline.

### M.1 Simple coupling — `simple`

The fraction of solid angle that is holes is the fraction of the hot gas that
escapes rather than pushing:

$$f_{\rm vent} = 1 - C_f \qquad\Rightarrow\qquad p_w = \eta\,C_f\,\dot p_w\,t$$

$\eta$ still comes from the Weaver ceiling with the Lancaster calibration. At
$C_f = 0.5$ this simply halves the delivered wind momentum.

**Assumption:** that escaping hot gas carries away its momentum share *pro rata*
with solid angle, and that venting does not change the boost itself. Neither is
derived; it is the minimal way to stop the two knobs contradicting each other.

### M.2 KM09 coupling — `km09`

KM09 solve the porous bubble properly. Ablation off the shell's inner face
(Canto & Raga 1991, jet-limited), their eq (26):

$$\dot M_{\rm abl} = 4\pi r_{\rm II}^{2}C_f\left(0.09\,\rho_{\rm II}\frac{c_{\rm II}^{2}}{2c_X}\right)$$

With pressure balance $\rho_{\rm II}c_{\rm II}^{2} = \rho_Xc_X^{2}$ and
$L_w = \dot M_wv_w^{2}/2$, steady state ($\dot M_X = \dot E_X = 0$, adiabatic
work negligible because $C_f\dot r_{\rm II}\ll(1-C_f)c_X$) reduces eqs (24)–(25)
to their eqs (27)–(28):

$$\dot M_w = 4\pi r_{\rm II}^{2}\rho_Xc_X\left[(1-C_f)-0.045C_f\right]$$
$$\dot M_wv_w^{2} = 20\pi r_{\rm II}^{2}\rho_Xc_X^{3}(1-C_f)$$

Eliminating $c_X$ gives their eq (29):

$$\rho_Xc_X^{2} = \frac{\dot M_wv_w/(4\pi r_{\rm II}^{2})}{\left[5(1-C_f)(1-1.045C_f)\right]^{1/2}}$$

The force on the shell is $4\pi r_{\rm II}^{2}\rho_Xc_X^{2}$ and the injected
rate is $\dot p_w = \dot M_wv_w$, so — using their own simplification
$(1-C_f)(1-1.045C_f)\simeq(1-1.02C_f)^{2}$ —

$$\boxed{\ \eta_{\rm KM09} = \max\!\left[1,\ \frac{1}{\sqrt5\,(1-1.02C_f)}\right]\ }$$

The boost depends on **nothing but the covering fraction**. The floor at 1 is
KM09's own: "values of $f_{\rm trap,w}$ less than $f_w$ are not realistic,
because the wind force is always present". The divergence at
$C_f\to1/1.02$ is also theirs and also not real — it comes from neglecting
adiabatic losses and shell accumulation once the holes close.

### M.3 The deviation — and it is large

| $C_f$ | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 |
|---|---|---|---|---|---|---|
| $\eta_{\rm KM09}$ | 1.00 | 1.00 | 1.15 | 1.56 | 2.43 | 5.45 |

**At KM09's own stated realistic value $C_f\lesssim1/2$, their analysis gives
$\eta = 1$ — no boost at all, a purely momentum-driven bubble.** Our
Lancaster-calibrated value is $\eta = 4.5$–6.5.

Inverting: reproducing Lancaster's $\alpha_p = 5.375$ through KM09's expression
needs $C_f = 0.899$ — a shell KM09 explicitly reject, "implausible given the
turbulent, clumpy nature of the ISM".

**So two published sources disagree by a factor ~5 about the same quantity**,
and this engine cannot satisfy both. They are not measuring quite the same
thing:

- KM09 is a **semi-analytic steady-state balance** in which mass and energy
  escape through holes. Its loss channel is *bulk escape*.
- Lancaster+2025 is **3D RMHD** in which the loss channel is *turbulent mixing*
  at the interface, and they find the photoionized region at that interface
  suppresses Ly$\alpha$ cooling, raising $\alpha_p$. Their with-LyC values are
  2× their own no-LyC ones (4.66/6.20 against 2.55/4.09), which is the size of
  the effect KM09 do not model at all.

Neither is wrong. The default stays on the Lancaster calibration because this
engine *has* an H II channel, so the irradiated case is the relevant one — but
the KM09 coupling is selectable precisely so the disagreement is visible rather
than hidden inside a default.

### M.4 What neither coupling models

$f_{\rm leak,w}$ (cooling) is still not derived from $C_f$, though it should
depend on it: Lancaster's mechanism is mixing at the interface, whose *area*
grows with porosity. We have no published $f_{\rm leak,w}(C_f)$ to use, so the
two remain separate knobs and the calibration absorbs the difference. This is
the largest remaining un-modelled coupling in the wind channel.

$\dot M_{\rm abl}$, $\rho_X$ and $c_X$ are not represented as state anywhere —
the KM09 coupling uses only the closed-form result, not the balance that
produced it.

---

## N. Terminal velocity, revisited

$v_\infty = \kappa\,v_{\rm esc,eff}$ with $\kappa$ now **2.6 above the
bi-stability jump, 1.3 below it** (Lamers, Snow & Lindholm 1995, via Vink sec 4)
for *both* prescriptions, replacing Björklund's grid mean of 4.5.

**Why substituting is legitimate for Björklund and would not be for Vink.**
Vink's eqs (24)/(25) carry $-c\log_{10}[(v_\infty/v_{\rm esc})/2.0]$ as an
**input term**, so $\dot M$ is evaluated *at* an assumed ratio and the two must
travel together. Björklund's eq (7) contains no $v_\infty$ term — it is a
function of $(L, M_{\rm eff}, T_{\rm eff}, Z)$ alone — so pairing it with an
observationally calibrated speed leaves the fit intact.

| | before | after | observed O stars |
|---|---|---|---|
| $\langle v_\infty\rangle$, Björklund | 5115–5180 km/s | **2956–2993** | ~1200–3500 |

**The tension, stated rather than hidden.** Björklund's headline negative result
is that there is **no bi-stability jump in mass loss** below ~20 kK. Using a
jump-dependent $v_\infty$ alongside a single-branch $\dot M$ mixes a claim the
paper rejects into a quantity the paper does not model. It is defensible — the
velocity ratios are an observational result about wind *dynamics*, independent
of whether $\dot M$ jumps — but it is our composition, not theirs. The $\dot M$
branch is untouched.

**Recalibration.** $\eta_{\max}\propto v_\infty(\rho_0/L_w)^{1/5}$ and
$L_w\propto v_\infty^{2}$, so the ceiling falls:

| | $\eta_{\max}$ before | after | $f_{\rm leak}$ |
|---|---|---|---|
| Björklund | 96.2–149.4 | **80.1–124.5** | 0.963 → **0.956** |
| Vink | 30.4–71.0 | unchanged | 0.905 |

The two prescriptions' leakage values converged (0.956 vs 0.905) once their wind
*speeds* were equalised — what remains is the $\dot M$ difference alone.

---

## O. What $\psi$ is, and the 1-versus-3.2 question

$$\psi \equiv \frac{L}{S\epsilon_0}$$

KM09 sec 2: "the ratio of the star's bolometric power to its ionizing power,
**counting only an energy $\epsilon_0$ per ionizing photon**." The last clause is
the whole subtlety. $S\epsilon_0$ is not the power carried by ionizing photons —
it is the ionizing photon *rate* times the 13.6 eV threshold. Real ionizing
photons average appreciably more than threshold, so $\psi$ is not simply
$L/L_{\rm ion}$.

For a hot star roughly half the bolometric luminosity sits above the Lyman
limit, and the mean photon energy there is ~20 eV, so
$S\epsilon_0 \approx 0.5L\times(13.6/20) \approx 0.34L$ and $\psi\approx3$.
That is what our clusters compute.

**Where it enters: r_ch and nothing else.** No budget quantity depends on
$\psi$ — the radiation momentum is $f_{\rm trap}(L/c)t$, which contains no
$\psi$. It locates the pressure crossing, so it decides *whether radiation or
gas pressure dominates*, not how much momentum is delivered.

**The case for 3.2 (what we use).** It is the correct evaluation of KM09's own
definition on our population, and it is consistent with their own inputs:
Sternberg's class-V table gives $\psi = 2.56$ (O3), 3.90 (O7), 20.9 (B0.5).
KM09's stated condition — luminosity dominated by massive stars — *holds* here:
96.6% of `orion`'s bolometric light comes from its 16 ionizing stars, so the
value is not being inflated by the low-mass majority. "$\psi\sim1$" is an
order-of-magnitude remark, not a measurement.

**The case for 1.** Every published $r_{\rm ch}$ relation is evaluated there —
KM09's $9.2\times10^{-2}S_{49}$ pc and Lopez et al. (2014)'s
$0.072\,S_{49}$ pc — so comparisons are only like-for-like at $\psi = 1$ *and*
$f_{\rm trap} = 2$.

**Reported, not switched.** `rChFiducialKM09` gives $r_{\rm ch}$ at that pair
alongside the working value:

| | $\psi$ | $r_{\rm ch}$ (ours) | $r_{\rm ch}$ at $\psi{=}1,f{=}2$ | Lopez eq (12) | $r_{\rm cloud}$ |
|---|---|---|---|---|---|
| diffuse | 6.51 | 0.15 | 0.06 | 0.05 | 3.0 |
| orion | 3.18 | 3.05 | 4.83 | 3.77 | 2.5 |
| compact | 3.47 | 10.12 | 13.31 | 10.40 | 2.0 |

The fiducial column now tracks Lopez to within 28%, confirming the formula is
applied correctly and the difference really is the parameter choice.

**Substituting $\psi=1$ into the working $r_{\rm ch}$ was tried and rejected.**
$\psi$ appears in $r_{\rm ch}$ but *not* in the pressure comparison, which uses
the true $L$ and $S$. Overriding it made `radiationDominated` (from
$r_{\rm ch}$) contradict `pressureRatioAtCloud` (from the pressures) — `orion`
read "not radiation dominated" while its pressure ratio was 1.10. Those two
fields are documented as equivalent by construction. A comparison number must
not be allowed to break an invariant.

**Unresolved.** Lopez measure 30 Doradus's transition at $\lesssim75$ pc against
the 33 pc the $\psi=1$ formula predicts, implying an effective $\psi\approx1.5$
— between the two. Our value is the correct arithmetic; whether $r_{\rm ch}$
computed with it is the right *physical* transition radius is genuinely open.
