/*
 * mathMacros.ts — the site's LaTeX "preamble": one definition per symbol.
 *
 * Same idea as a paper's macro block. Notation is defined ONCE here and reused
 * everywhere, so "solar mass" or "the coupling parameter" can never drift between
 * pages. Passed to KaTeX by the <Math> component (and by remark/rehype-katex if
 * markdown math is added later).
 *
 * Usage:  <Math tex={String.raw`3\,\Msun`} />   ->  3 M⊙
 */
export const mathMacros: Record<string, string> = {
  // Solar units
  "\\Msun": "M_\\odot",
  "\\Rsun": "R_\\odot",
  "\\Lsun": "L_\\odot",

  // Common units (upright, per convention)
  "\\pc": "\\mathrm{pc}",
  "\\kpc": "\\mathrm{kpc}",
  "\\Myr": "\\mathrm{Myr}",
  "\\Kelvin": "\\mathrm{K}",
  "\\cmc": "\\mathrm{cm^{-3}}",

  // Model quantities used across the /explore suite
  "\\lcorr": "\\lambda_\\mathrm{corr}", // mass<->density coupling (McLuster A1)
  "\\rhoz": "\\rho_0", // colorbar reference density
  "\\rt": "r_\\mathrm{t}", // EFF truncation radius
  "\\rh": "r_\\mathrm{h}", // half-mass radius
  "\\mach": "\\mathcal{M}", // turbulent Mach number
};
