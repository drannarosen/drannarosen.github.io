# The feedback-budget model

What `/explore/feedback-budget` actually solves, with every equation, its
source, and the assumptions it rests on. Written for review, not for the page.

Code: `src/novascope/core/feedback/` (Layer 0, pure). Gate:
`scripts/check-feedback.mjs`. Last verified against the shipped realizations
2026-08-09.

**This is an accounting tool, not a hydrodynamics run.** It integrates
per-channel momentum and energy over a fixed window and compares the totals to
two thresholds. Nothing here solves an equation of motion for the gas.

---

## 0. The question

Two stages, in the order the physics asks them.

**Stage 1 — does the gas go?** Compare the retained feedback momentum against
what it costs to lift the *residual gas* out of the cloud potential. The
threshold uses $M_{\rm gas}$, not $M_{\rm cloud}$: the stars are the sources,
not the payload.

**Stage 2 — do the stars stay?** If the gas goes, the stars keep their kinetic
energy while $|W|$ drops to their own self-gravity. Bound iff

$$q \equiv \frac{T}{|W_\star|} < 1$$

(virialised at $0.5$, positive total energy at $1$). Hills (1980). This is read
from the export's `q_virial_stars_only` and is **independent of the budget** —
no control on the page changes it.

---

## 1. Sources, per star

Stellar properties come from the export (progenax's own $T_{\rm eff}$, $R$),
never re-derived, so the stars the ledger reasons about are the stars the scene
renders.

**Bolometric luminosity** — Stefan–Boltzmann inverse:

$$L = \left(\frac{T_{\rm eff}}{T_{\rm eff,\odot}}\right)^{4}\left(\frac{R}{R_\odot}\right)^{2}$$

**Ionizing photon rate** — Sternberg, Hoffmann & Pauldrach (2003), Table 1,
luminosity class V (WM-basic, solar $Z$):

$$Q = 4\pi R^{2}\, q_{\rm H}(T_{\rm eff}), \qquad \log q_{\rm H} \ \text{linearly interpolated in } T_{\rm eff}$$

$Q \equiv 0$ below $T_{\rm eff} = 32{,}060$ K (the grid's cool edge). Not
extrapolated — $\log Q_{\rm H}$ falls by $>100\times$ from O3 to B0.5, so cooler
stars are negligible, and extrapolating a calibration past its range is what
would stop the budget being selective by environment.

**Integration window** — time to the first supernova, i.e. $t_{\rm MS}$ of the
most massive star present, from Hurley, Pols & Tout (2000) eq (5). Emergent, not
a knob: a richer cluster samples a more massive star and gets a *shorter*
window. Mass is clipped to $[0.08, 150]\,M_\odot$ first, matching the export's
own clip, so $t_{\rm MS}$ is evaluated at the same mass whose $T_{\rm eff}$ and
$R$ the star carries.

---

## 2. Winds

### 2.1 Mass-loss rate

Default **Björklund et al. (2023)**, A&A 676, A109, eq (7):

$$\log \dot M = -5.52 + 2.39\log\frac{L}{10^{6}L_\odot} - 1.48\log\frac{M_{\rm eff}}{45M_\odot} + 2.12\,\ell + \left(0.75 - 1.87\,\ell\right)\log\frac{Z}{Z_{\odot,\rm BJ}}$$

with $\ell = \log(T_{\rm eff}/45\,{\rm kK})$ and the Eddington-reduced mass
$M_{\rm eff} = M(1-\Gamma_e)$.

Alternative **Vink, de Koter & Lamers (2001)** eqs (24)/(25), with the
bi-stability jump temperature computed per star from their eqs (11)→(23)→(15)
rather than fixed at 25 kK.

**Each recipe normalizes to its own $Z_\odot$** — Vink $0.02$ (classic solar,
the scale Tout 1996 uses), Björklund $0.014$ (their sec 3.1). The anchor lives
*inside* each rate function and is not a parameter, so the two cannot share one.

**Eddington factor**, Vink eq (11):

$$\Gamma_e = 7.66\times10^{-5}\,\sigma_e\,\frac{L/L_\odot}{M/M_\odot}, \qquad \sigma_e = 0.2(1+X)$$

### 2.2 Terminal velocity

$$v_{\rm esc,eff} = \sqrt{\frac{2GM(1-\Gamma_e)}{R}}, \qquad v_\infty = \kappa\, v_{\rm esc,eff}$$

$\kappa = 4.5$ (Björklund sec 5.1 grid mean), or $2.6 / 1.3$ either side of
Vink's bi-stability jump (Lamers et al. 1995).

The $(1-\Gamma_e)$ is not a correction bolted on — it *is* the escape velocity
from the net inward acceleration the outflowing gas feels. As
$\Gamma_e \to 1$ the star reaches Eddington and material is marginally unbound
with vanishing effort, so $v_{\rm esc}\to 0$; the plain $\sqrt{2GM/R}$ stays
large there, which is the wrong limit.

### 2.3 Injection rates

Rosen (2022) sec 2.4.3:

$$\dot p_w = \sum_i \dot M_i v_{\infty,i}, \qquad \dot E_w = \sum_i \tfrac{1}{2}\dot M_i v_{\infty,i}^{2}$$

Summed per star, **not** rebuilt from a mean terminal velocity:
$\frac12\sum \dot M \langle v\rangle^2$ understates $\dot E_w$ whenever the wind
speeds differ, since $\langle v^2\rangle \ge \langle v\rangle^2$.

### 2.4 The momentum boost $\eta$

$$\eta \equiv \frac{p_{\rm shell}}{p_{\rm injected}}$$

$\eta = 1$ is momentum-driven (shocked gas cools instantly). $\eta \gg 1$ is
energy-driven: the hot bubble does $P\,dV$ work on the swept shell, so the shell
carries far more momentum than the wind supplied. Both endpoints are physically
defined, which is what makes interpolating between them legitimate rather than a
fudge.

$\eta_{\max}$ is **derived**, not cited, from Weaver et al. (1977) eq (21),
$R = a(L_w t^3/\rho_0)^{1/5}$ with $a = 0.76$:

$$v = \frac{dR}{dt} = \frac{3}{5}\frac{R}{t}, \qquad M_{\rm sh} = \tfrac{4}{3}\pi R^{3}\rho_0, \qquad p_{\rm sh} = M_{\rm sh}v = \frac{4\pi}{5}\frac{\rho_0 R^{4}}{t}$$

$$\Rightarrow \quad \eta_{\max} = \frac{4\pi}{5}\frac{a^{4}}{2}\,v_\infty\left(\frac{\rho_0}{L_w}\right)^{1/5}t^{2/5}$$

So $\eta_{\max}$ is **not a universal constant**: it grows as $t^{2/5}$ and
depends on ambient density, mechanical luminosity and wind speed. It is
evaluated **at breakout** (when the bubble reaches $r_{\rm cloud}$) — past that
there is no more cloud to sweep, and evaluating at the full window would credit
momentum to material that is not there (it inflates $\eta$ by $3$–$4\times$).

### 2.5 Leakage, and how $f_{\rm leak}$ is set

$$E_{\rm ret} = (1-f_{\rm leak})E_{\rm inj}, \qquad \eta = 1 + (\eta_{\max}-1)(1-f_{\rm leak}), \qquad p_{\rm ret} = \eta\,(1-f_{\rm vent})\,p_{\rm inj}$$

Cooling and venting are **separate knobs** deliberately: cooling radiates energy
while the mass stays; venting removes the mass *and* carries its momentum out,
so it attenuates the injected momentum itself rather than only the boost.

$f_{\rm leak}$ is **calibrated, not chosen.** Lancaster, Kim, Kim, Ostriker &
Bryan (2025) define a momentum enhancement factor by their eq (4),
$p = \alpha_p\,p_{w,\rm MD}$ — identical to our $\eta$ — and measure it in 3D
RMHD. Their Fig. 3, time- and resolution-averaged **with LyC radiation**:
$\alpha_p = 4.66$ (HWR), $6.20$ (MWR), with reference lines at 3 and 8. The
with-LyC pair is the right one here because this engine has an H II channel, and
the paper gives the reason: the photoionized region sits at the bubble interface,
so the wind never touches neutral gas and cools less through Ly$\alpha$.

$f_{\rm leak}$ is then solved so the resulting $\eta$ range is *geometrically
centred* on $\sqrt{4.66 \times 6.20} = 5.375$ across the shipped $\eta_{\max}$
spread:

| prescription | $f_{\rm leak}$ | resulting $\eta$ |
|---|---|---|
| Björklund | 0.963 | 4.52 – 6.49 |
| Vink | 0.905 | 3.79 – 7.65 |

Centring on the *median* $\eta_{\max}$ instead pushed Vink's `diffuse` to
$\eta = 11.6$, outside the paper's bracket. The gate re-derives both constants
from the data and fails on drift.

---

## 3. Photoionization

**One merged, cloud-centred region** driven by $S = \sum_i Q_i$, not a sum of
per-star regions. Justification is measured, §6.

**Mean gas density and Strömgren radius** (KM09 eq 2, on-the-spot):

$$\bar n_{\rm H} = \frac{\rho_{\rm gas}}{\mu m_{\rm H}},\quad \rho_{\rm gas} = \frac{M_{\rm gas}}{\frac{4}{3}\pi r_{\rm cloud}^{3}},\quad \mu = 1.4$$

$$\tfrac{4}{3}\pi R_S^{3}\alpha_B \bar n_{\rm H}^{2} = \phi S \quad\Rightarrow\quad R_S = \left(\frac{3\phi S}{4\pi\alpha_B \bar n_{\rm H}^{2}}\right)^{1/3}$$

$\alpha_B = 3.46\times10^{-13}$ cm³/s, $\phi = 0.73$, $T_{\rm II} = 7000$ K —
KM09's fiducial set, which travels together.

**D-type (Spitzer) expansion:**

$$R(t) = R_S\left(1 + \frac{7 c_{\rm II} t}{4R_S}\right)^{4/7}, \qquad v(t) = c_{\rm II}\left(1 + \frac{7c_{\rm II}t}{4R_S}\right)^{-3/7}$$

with $c_{\rm II} = 10$ km/s. Hence $R \propto t^{4/7}$, $v \propto t^{-3/7}$, and
$p = M_{\rm sh}v \propto t^{9/7}$ — **super-linear**, unlike the other two
channels. This is why the H II curve is recomputed at every sample rather than
scaled.

**Swept mass — from the enclosed-gas profile, not $\rho \times V$:**

$$M_{\rm sh}(t) = M_{\rm gas}\, f_{\rm enc}\!\big(R(t)\big)$$

$f_{\rm enc}$ is the export's tabulated $M_{\rm gas}(<r)/M_{\rm gas}$
(`gas_menc.f32`, 1024 uniform samples), the *same* profile `binding.ts`
integrates for $E_{\rm bind}$ and the evacuation animation draws. Bounded by
construction, so the front cannot sweep more gas than exists.

**Freeze at cloud-filling.** Inverting the Spitzer solution,

$$t_{\rm fill} = \frac{4R_S}{7c_{\rm II}}\left[\left(\frac{r_{\rm cloud}}{R_S}\right)^{7/4} - 1\right]$$

Past $t_{\rm fill}$ the region is evaluated at $t_{\rm fill}$: it gains no more
mass and no more momentum, but does not lose any. Continuing to decelerate a
shell of fixed mass would make delivered momentum *fall*, which is the Spitzer
solution read outside its domain.

**Delivered:**

$$p_{\rm II} = (1-f_{\rm leak,II})\,M_{\rm sh}v, \qquad E_{\rm II} = (1-f_{\rm leak,II})\,\tfrac{3}{2}M_{\rm sh}\frac{k_B T_{\rm II}}{\mu m_{\rm H}}$$

No $\eta$: ionizing photons carry negligible momentum, so the delivered momentum
*is* the shell momentum.

**Trapping.** The channel is switched off entirely when

$$v_{\rm esc,cloud} > c_{\rm II} \approx 10\ {\rm km/s}$$

— thermal expansion cannot drive material out however large $S$ becomes. This
fires for `compact` ($v_{\rm esc} = 20.3$ km/s).

---

## 4. Radiation pressure

$$p_{\rm rad} = f_{\rm trap}\frac{L}{c}\,t$$

No $\eta$ — the injected momentum $L/c$ is delivered directly, and $f_{\rm trap}$
is its boost. $\eta$ comes from $P\,dV$ work by a hot bubble, $f_{\rm trap}$ from
a photon interacting more than once; the two must not be conflated.

$$f_{\rm trap} = C_f + f_{\rm trap,IR} + f_{\rm trap,Ly\alpha}$$

**The direct term is $C_f$, not 1.** KM09 sec 2: $f_{\rm trap}=1$ is "every
photon … absorbed once in the shell", i.e. full covering; $f_{\rm trap}=0$ is the
optically thin shell where "all stellar photons escape without depositing any
momentum". Their eq (35) names the loss explicitly —
$L = (1-C_f)L + 3\pi r^{2}(1-C_f)P_{\rm IR}$, whose first right-hand term is the
radiation that "escapes the shell without interacting".

$C_f = 0.5$: KM09's own "realistic values of $C_f \lesssim 1/2$", which is also
the ceiling for a blister geometry.

**IR trapping** — KM09 eq (34), their fit to a diffusion calculation through
Weingartner & Draine (2001) dust model A:

$$f_{\rm trap,IR} = \left[\Sigma_{\rm sh}^{-3}\left(\frac{132}{T_{\rm eff,sh}}\right)^{6} + \Sigma_{\rm sh}^{-1.92}\left(\frac{72}{T_{\rm eff,sh}}\right)^{1.71}\right]^{-2/3}$$

$$T_{\rm eff,sh} = \left(\frac{L}{4\pi r^{2}\sigma_{\rm SB}}\right)^{1/4}$$

Evaluates to $\sim0.002$ for every shipped environment (shells at 11–45 K,
$\Sigma_{\rm sh} = 0.003$–0.4 g/cm²), far below the $\Sigma_{\rm sh}\gtrsim1$,
$T\gtrsim60$ K regime where trapping matters. That is a **result**, computed per
environment, not an assumption.

We deliberately do **not** use their eq (37), $f_{\rm trap,IR} = \frac43 C_f/(1-C_f)$,
which would give 1.33 at $C_f = 0.5$: its precondition is a shell optically thick
to IR, and ours are not — $f_{\rm trap,IR}\approx0$ *is* that measurement.

$f_{\rm trap,Ly\alpha} = 0$: KM09 sec 3.3 find trapped Ly$\alpha$ saturates once
dust destroys the photons.

**Never their fiducial $f_{\rm trap} = 2$** — that includes $f_{\rm trap,w}$, the
hot shocked wind pushing the shell, which they must fold in because they have one
shell equation and we must not because that is our wind channel.

**Characteristic radius** — KM09 eqs (4)–(5), where the two pressure terms
balance:

$$r_{\rm ch} = \frac{\alpha_B}{12(1,4)\pi\phi}\left(\frac{\epsilon_0}{k_BT_{\rm II}}\right)^{2}\frac{\psi^{2}S}{c^{2}}f_{\rm trap}^{2}, \qquad \psi = \frac{L}{S\epsilon_0}$$

with $(1,4)$ for a (spherical, blister) region. Radiation dominates *inside*
$r_{\rm ch}$, gas pressure outside. **$\psi$ is computed from our own $L$ and
$S$, not assumed** — see §6 for why that matters.

---

## 5. The cloud potential

Truncated EFF (Elson–Fall–Freeman 1987), with **both** dimensionless
coefficients derived from the same enclosed-mass construction the sampler uses —
one source of truth for the profile, and they generalize to any $\gamma$.

**Binding energy.** From $W = -\int G M(<r)\,dM/r$:

$$|W| = \alpha\frac{GM^{2}}{r_t}, \qquad \alpha = r_t\!\int_0^{r_t}\frac{m}{r}\frac{dm}{dr}dr$$

$\alpha = 0.976\ (\gamma=4.2)$, $0.825\ (\gamma=3.2)$.

**Escape speed.** The gas is distributed *through* the profile, so it is charged
the mass-weighted escape speed, not the surface value:

$$\Phi(r) = -G\left[\frac{M(<r)}{r} + \int_r^{r_t}\frac{dM}{r'}\right], \qquad \beta = \frac{\langle\sqrt{2|\Phi(r)|}\rangle_{\rm mass}}{\sqrt{2GM/r_t}}$$

$\beta = 1.383\ (\gamma=4.2)$, $1.275\ (\gamma=3.2)$ — so using
$\sqrt{2GM/r_t}$ understated the threshold by ~38%.

Validated against a closed form: as $r_t/a \to 0$ only the flat core survives and
the cloud becomes a uniform sphere, for which

$$\beta \to \frac{1}{\sqrt2}\int_0^1 3x^{2}\sqrt{3-x^{2}}\,dx = \frac{27}{8\sqrt2}\left[\theta - \frac{\sin4\theta}{4}\right]_{\theta=\arcsin(1/\sqrt3)} = 1.09378\ldots$$

The code returns 1.093816.

**Thresholds:**

$$E_{\rm bind} = \alpha\frac{GM_{\rm cloud}^{2}}{r_t}, \qquad p_{\rm needed} = M_{\rm gas}\,\beta\sqrt{\frac{2GM_{\rm cloud}}{r_t}}$$

---

## 6. Assumptions and known limitations

Ordered by how much they could change a conclusion.

1. **$\psi \approx 3.2$, published relations assume 1.** KM09 define
   $\psi = L/(S\epsilon_0)$ and say "$\psi\sim1$" for clusters whose light comes
   from massive stars. That condition *holds* here (96.6% of orion's $L$ is from
   its 16 ionizing stars), yet the computed value is 3.18. It is consistent with
   their own inputs — Sternberg's table gives $\psi = 2.56$ (O3), 3.90 (O7) — so
   $\psi\sim1$ is a loose order-of-magnitude, and ours is the correct number.
   But $r_{\rm ch}\propto\psi^2$, so we sit ~10× above relations calibrated at
   $\psi=1$. The one direct observational constraint (Lopez et al. 2014: 30 Dor's
   transition measured at $\lesssim75$ pc against 33 pc predicted at $\psi=1$)
   implies an effective $\psi\approx1.5$ — between the two. **Our $r_{\rm ch}$ is
   probably still an over-estimate.**

2. **The export's `local_density.f32` is saturated.** On the 128³ grid, 7,973 of
   orion's 10,301 stars (77%) share one identical cell value,
   $7.3\times10^{6}\,M_\odot/{\rm pc}^3$ = $n_{\rm H} = 2.1\times10^{8}$ cm⁻³,
   $2.4\times10^{4}\times$ the cloud mean (~10σ for $\sigma_{\ln\rho}=1.94$); only
   139 distinct values exist. Now unused in the feedback path, but it is still the
   coupling key for mass segregation. **Needs a higher-resolution re-export.**

3. **Merged vs per-star H II geometry.** Justified by measurement: at the mean
   density, `overlap` (median per-star radius / mean source separation) is
   4.2–5.4, and every source in `orion` and `diffuse` has an unconstrained front
   larger than the whole cloud. Computed from the *saturated* density it reads
   0.18–0.61, which is the artifact, not the physics.

4. **$f_{\rm leak}$ differs by prescription** (0.963 / 0.905). It ought to be a
   property of the cloud's mixing physics, not of the wind recipe. But
   $\eta_{\max}$ depends on mechanical luminosity, and Björklund's faster winds
   give a ceiling 2–3× Vink's, so matching the *same measured* $\eta$ requires
   leaking a larger share of a larger number. Calibrating to a measurement means
   $f_{\rm leak}$ absorbs the difference.

5. **Björklund's validity box stops at 80 $M_\odot$**, but the realizations reach
   131 (orion) and 195 (compact). Those stars carry 75–84% of the wind momentum on
   the Vink scale and contribute **zero** under the default. Not extrapolating is
   right; the coverage is reported on the page as "wind sources $n$ of $N$".

6. **$v_\infty$ is composed across model rungs.** $\kappa = 4.5$ is Björklund's
   grid mean over MESA *evolutionary tracks*; we apply it to *ZAMS* Tout radii,
   which are more compact. Result: $\langle v_\infty\rangle = 5115$–5180 km/s
   against their grid mean of 3300. Wind energy carries $\sim2.4\times$ of that.
   The paper already flags its own 3300 as "not generally found in the
   observational literature".

7. **Spherical geometry throughout.** KM09's blister case is available
   (`spherical` flag) and is 4× smaller in $r_{\rm ch}$; it is not used.

8. **Stars are static ZAMS.** No evolution within the window, by construction —
   which is what makes the budget's time dependence come entirely from how each
   channel deposits momentum. No supernovae: the window *ends* at the first one.

9. **Channels are summed independently.** No coupling term. Real winds, H II gas
   and radiation share a shell and interact; the ledger asks only "how much did
   each deliver".

10. **Stochastic sampling is real, not noise.** `diffuse`'s wind channel is two
    stars, one of which supplies 81% of $\dot p_w$. Its $\dot p_w/M_\star$ sits
    0.09× the Starburst99 fully-sampled value — expected, since SB99 samples a
    complete IMF.

---

## 7. Sources

| Quantity | Source |
|---|---|
| ZAMS $L$, $R$, $T_{\rm eff}$ | Tout, Pols, Eggleton & Han (1996), MNRAS 281, 257 |
| $t_{\rm MS}$ | Hurley, Pols & Tout (2000), MNRAS 315, 543, eq (5) |
| $q_{\rm H}(T_{\rm eff})$ | Sternberg, Hoffmann & Pauldrach (2003), Table 1, class V |
| $\dot M$ (default) | Björklund, Sundqvist, Singh, Puls & Najarro (2023), A&A 676, A109, eq (7) |
| $\dot M$ (alternative) | Vink, de Koter & Lamers (2001), A&A 369, 574, eqs (24)/(25) |
| $\eta_{\max}$ | Weaver, McCray, Castor, Shapiro & Moore (1977), ApJ 218, 377, eq (21) |
| $\alpha_p$ calibration | Lancaster, Kim, Kim, Ostriker & Bryan (2025), ApJ, Fig. 3 |
| H II expansion, $f_{\rm trap}$, $r_{\rm ch}$ | Krumholz & Matzner (2009), ApJ 703, 1352 |
| $r_{\rm ch}$ observational check | Lopez, Krumholz, Bolatto, Prochaska, Ramirez-Ruiz & Castro (2014), ApJ 795, 121 |
| Wind injection terms | Rosen (2022), ApJ 941, 202, sec 2.4.3 |
| Stage-2 criterion | Hills (1980); Baumgardt & Kroupa (2007) for bound fraction |
| Cloud profile | Elson, Fall & Freeman (1987) |
