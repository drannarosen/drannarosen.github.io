// =============================================================================
// CV — Anna Lorraine Rosen, Ph.D.
// Typst source  ·  Design: monochrome + vivid teal
// =============================================================================

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
#let accent     = rgb("#0d9488")
#let charcoal   = rgb("#1f2937")
#let body-color = rgb("#374151")
#let secondary  = rgb("#6b7280")
#let light-rule = rgb("#e5e7eb")
#let bg-subtle  = rgb("#f3f4f6")

// ---------------------------------------------------------------------------
// Font helpers
// ---------------------------------------------------------------------------
#let sans = "Inter"
#let serif = "Source Serif 4"
#let mono = "JetBrains Mono"

// ---------------------------------------------------------------------------
// Reusable components
// ---------------------------------------------------------------------------

// Section header: 4pt teal left bar · Inter SemiBold 14pt · gray rule
#let cv-section(title) = {
  v(12pt)
  block(width: 100%, {
    grid(
      columns: (4pt, 1fr),
      column-gutter: 8pt,
      rect(width: 4pt, height: 18pt, fill: accent, radius: 1pt),
      {
        text(font: sans, weight: "semibold", size: 14pt, fill: charcoal, title)
        v(3pt)
        line(length: 100%, stroke: 0.5pt + light-rule)
      },
    )
  })
  v(6pt)
}

// Subsection header: Inter Medium 11pt, teal
#let cv-subsection(title) = {
  v(5pt)
  text(font: sans, weight: "medium", size: 11pt, fill: accent, title)
  v(3pt)
}

// Entry with right-aligned date (auto-converts -- to en-dash)
#let cv-entry(body-content, date) = {
  let d = if type(date) == str { date.replace("--", "\u{2013}") } else { date }
  grid(
    columns: (1fr, auto),
    column-gutter: 8pt,
    body-content,
    text(font: sans, weight: "medium", size: 9.5pt, fill: charcoal, d),
  )
}

// Pill badge
#let pill(label, color: accent) = {
  box(
    inset: (x: 5pt, y: 2pt),
    radius: 8pt,
    stroke: 0.75pt + color,
    text(font: sans, size: 7.5pt, weight: "medium", fill: color, upper(label)),
  )
}

// Skill pill (light outline on dark background)
#let skill-pill(label) = {
  box(
    inset: (x: 5pt, y: 2.5pt),
    radius: 8pt,
    stroke: 0.75pt + accent,
    text(font: mono, size: 7pt, fill: accent, label),
  )
}

// Publication number circle
#let pub-number(n) = {
  box(
    width: 20pt, height: 20pt,
    radius: 10pt,
    fill: accent,
    align(center + horizon, text(font: sans, size: 9pt, weight: "bold", fill: white, str(n))),
  )
}

// Stat block for sidebar
#let stat-block(number, label) = {
  block(width: 100%, {
    text(font: sans, size: 16pt, weight: "bold", fill: accent, number)
    linebreak()
    text(font: sans, size: 7.5pt, fill: white, upper(label))
  })
  v(3pt)
}

// Sidebar section label
#let sidebar-label(title) = {
  text(font: sans, weight: "semibold", size: 8.5pt, fill: rgb("#9ca3af"), upper(title))
  v(3pt)
}

// Highlight author name in teal bold
#let me(name) = text(weight: "bold", fill: accent, name)

// ADS link pill
#let ads-link(url) = {
  h(4pt)
  link(url, pill("NASA ADS"))
}

// Small teal star for refereed-publication indicator
#let ref-star = text(fill: accent, size: 9pt, "★")

// ---------------------------------------------------------------------------
// PAGE 1 — Header + Sidebar + Main Column
// ---------------------------------------------------------------------------

#set document(
  title: "Curriculum Vitae — Anna L. Rosen",
  author: "Anna L. Rosen",
)

// Global text defaults
#set text(font: serif, size: 10pt, fill: body-color)
#set par(leading: 0.55em)

// Unified page setup — teal accent stripe on pages 2+, sidebar charcoal via grid cell
#set page(
  paper: "us-letter",
  margin: (top: 0.4in, bottom: 0.5in, left: 0in, right: 0.55in),
  background: context {
    let pg = counter(page).get().first()
    if pg == 1 {
      place(left + top, rect(width: 2.3in, height: 100%, fill: charcoal))
    } else {
      place(left + top, rect(width: 3pt, height: 100%, fill: accent))
    }
  },
  footer: context {
    set text(font: sans, size: 8pt, fill: secondary)
    let current = counter(page).get().first()
    let total = counter(page).final().first()
    pad(left: if current == 1 { 2.47in } else { 0.85in }, grid(
      columns: (1fr, auto),
      [Anna L. Rosen, Ph.D. – Curriculum Vitae],
      [Page #current of #total],
    ))
  },
)

// ---------- Header (right column only) ----------
#block(width: 100%, inset: (left: 2.47in, top: 0pt), {
  text(font: sans, weight: "bold", size: 20pt, fill: charcoal, "Anna Lorraine Rosen, Ph.D.")
  v(1pt)
  line(length: 100%, stroke: 2pt + accent)
  v(1pt)
  text(font: serif, size: 9pt, fill: secondary, style: "italic", "Computational Astrophysicist")
})

#v(1pt)

// ---------- Two-column: sidebar + main ----------
#grid(
  columns: (2.3in, 1fr),
  column-gutter: 0pt,

  // ===== LEFT SIDEBAR =====
  block(width: 100%, inset: (x: 14pt, y: 10pt), {
    set text(fill: white)

    // -- Contact --
    sidebar-label("Contact")
    text(font: sans, size: 8.5pt, fill: white, "alrosen@sdsu.edu")
    linebreak()
    text(font: sans, size: 8.5pt, fill: accent, link("https://anna-rosen.com", "anna-rosen.com"))
    linebreak()
    text(font: sans, size: 8.5pt, fill: rgb("#d1d5db"), "San Diego State University")
    linebreak()
    text(font: sans, size: 8.5pt, fill: rgb("#d1d5db"), "Dept. of Astronomy")
    linebreak()
    text(font: sans, size: 8.5pt, fill: rgb("#d1d5db"), "5500 Campanile Dr, San Diego, CA 92182")
    linebreak()
    text(font: sans, size: 7.5pt, fill: secondary, link("https://orcid.org/0000-0003-4423-0660", "ORCID: 0000-0003-4423-0660"))
    v(10pt)

    // -- At a Glance --
    sidebar-label("At a Glance")
    stat-block("34", "Publications")
    stat-block("55+", "Invited Talks")
    stat-block("9", "Graduate Students Mentored")
    stat-block("5", "Courses Developed / Taught")
    v(6pt)

    // -- Technical Skills --
    sidebar-label("Technical Skills")
    v(1pt)
    text(font: sans, size: 7pt, fill: rgb("#9ca3af"), "Languages")
    v(2pt)
    {
      let langs = ("C++", "Python/JAX", "TypeScript", "HTML", "MPI", "Mathematica", "Fortran", "IDL", "R")
      for lang in langs {
        skill-pill(lang)
        h(2pt)
      }
    }
    v(4pt)
    text(font: sans, size: 7pt, fill: rgb("#9ca3af"), "Simulation Codes")
    v(2pt)
    {
      let codes = ("Quokka", "ORION2", "GIZMO", "MESA")
      for code in codes {
        skill-pill(code)
        h(2pt)
      }
    }
    v(4pt)
    text(font: sans, size: 7pt, fill: rgb("#9ca3af"), "Analysis Codes")
    v(2pt)
    {
      let codes = ("yt", "RADMC-3D", "SKIRT")
      for code in codes {
        skill-pill(code)
        h(2pt)
      }
    }
    v(10pt)

    // -- Research Interests --
    sidebar-label("Research Interests")
    set text(font: sans, size: 8.5pt, fill: white)
    [Star Formation \ Stellar Feedback \ Radiation Hydrodynamics \ Multi-wavelength Observations \ Computational Astrophysics \ GPU-native Simulations \ HPC/Machine Learning]
  }),

  // ===== RIGHT MAIN COLUMN =====
  block(inset: (left: 12pt, right: 0pt), {

    // -- Employment --
    cv-section("Employment")
    cv-entry([Assistant Professor, Dept. of Astronomy, San Diego State University], "2023--Present")
    v(2pt)
    cv-entry([UC Chancellor's Postdoctoral Fellowship, UC San Diego], "2022--2023")
    v(2pt)
    cv-entry([NSF Astronomy & Astrophysics Postdoctoral Fellowship, UC San Diego], "2022--2023")
    v(2pt)
    cv-entry([ITC Postdoctoral Fellowship, Harvard University], "2020--2022")
    v(2pt)
    cv-entry([NASA Einstein Postdoctoral Fellowship, Harvard University], "2017--2020")

    // -- Education --
    cv-section("Education")
    cv-entry([*Ph.D.*, Astronomy & Astrophysics, UC Santa Cruz], "2017")
    block(inset: (left: 10pt), text(size: 9pt, fill: secondary, style: "italic",
      link("https://ui.adsabs.harvard.edu/abs/2017PhDT.......182R/abstract",
        text(fill: accent, "The Destructive Birth of Massive Stars & Massive Star Clusters"))))
    v(2pt)
    cv-entry([*M.S.*, Astronomy & Astrophysics, UC Santa Cruz], "2012")
    v(2pt)
    cv-entry([*B.A.*, Physics & Astrophysics (double major), UC Berkeley], "2009")
    v(2pt)
    cv-entry([*Community College Transfer Student*, Los Angeles Pierce College], "2007")

    // -- Awards --
    cv-section("Awards")
    cv-entry([Assigned Time for Research (Fall 2026), SDSU Div. of Research & Innovation], "2026")
    block(inset: (left: 10pt), text(size: 8.5pt, fill: secondary, style: "italic",
      [_gravax_: Population-Scale Star Cluster Inference with Differentiable Dynamics]))
    v(1pt)
    cv-entry([#smallcaps[athena] Faculty Champion (#link("https://www.athenastemwomen.org/", text(fill: accent, "athenastemwomen.org")); SDSU)], "2024")
    v(1pt)
    cv-entry([DRI GREW Fellowship, Div. of Research and Innovation, SDSU], "Fall 2024")
    v(1pt)
    cv-entry([Rodger Doxsey Dissertation Prize, American Astronomical Society], "2017")
    v(1pt)
    cv-entry([ARCS Foundation Fellowship], "2016")
    v(1pt)
    cv-entry([AAUW American Dissertation Year Fellowship], "2016")
    v(1pt)
    cv-entry([Excellence in Mentoring Award, UC Santa Cruz Astro. Dept.], "2015")
    v(1pt)
    cv-entry([AAS International Travel Grant], "2014, 2016, 2017")
    v(1pt)
    cv-entry([NSF Graduate Research Fellowship Program], "2011")
    v(1pt)
    cv-entry([NASA Minority Initiatives Internship, NASA JPL], "2008")
    v(1pt)
    cv-entry([Daniel Edward Wark Memorial Scholarship, UC Berkeley], "2009")
    v(1pt)
    cv-entry([NASA MUST Internship, NASA JPL], "2008")
    v(1pt)
    cv-entry([NASA MUST Scholarship], "2007--2008")
    v(1pt)
    cv-entry([NSF REU Internship, UC Davis Physics Dept.], "2007")
    v(1pt)
    cv-entry([Alexander Frolich Award, Los Angeles Pierce College], "2007")
    v(1pt)
    cv-entry([NASA JPL Undergraduate Scholars Award, LAPC], "2007")
    v(1pt)
    cv-entry([Thomas McCutcheon Award, Los Angeles Pierce College], "2006")

  }),
)

// Content below the sidebar grid flows with consistent left margin
#show: rest => pad(left: 0.85in, right: 0.2in, rest)

// ============================================================
// SUCCESSFUL PROPOSALS
// ============================================================
#cv-section("Successful Proposals")

#text(size: 9.5pt, [Total grants obtained as PI: *\$174,825*])
#v(3pt)
#cv-entry([Co-I, Chandra Observation, Cycle 21 (awarded 100 ks)], "2019")
#block(inset: (left: 10pt), text(size: 8.5pt, fill: secondary, style: "italic",
  [A Super Star Cluster is Born: Probing the X-ray Emission of H72.97-69.39 in LMC-N79]))
#v(2pt)
#cv-entry([PI, Chandra Theory, Cycle 16], "2014")
#block(inset: (left: 10pt), text(size: 8.5pt, fill: secondary, style: "italic",
  [To Leak or Not to Leak: Where are the Missing X-ray Photons from Massive Star Clusters?]))
#v(2pt)
#cv-entry([PI, Hubble Archival, Cycle 21], "2013")
#block(inset: (left: 10pt), text(size: 8.5pt, fill: secondary, style: "italic",
  [Simulating the Birth of Massive Star Clusters: Is Destruction Inevitable?]))

// ============================================================
// ADVISING EXPERIENCE
// ============================================================
#cv-section("Advising Experience")

#cv-subsection("Graduate Students")

#cv-entry([Surinder Singh Chhabra (Masters Student, SDSU)], "2025--Present")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [#smallcaps[orbit-rag]: Orchestrated Retrieval with Balanced Iteration & Termination for Astrophysics Research]))
#v(3pt)

#cv-entry([Aisling Ascuna (Masters Student, SDSU)], "2024--Present")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Lead Developer, #smallcaps[Sim2SKIRT]: a RMHD simulation-to-synthetic observation pipeline with #smallcaps[skirt]]))
#v(3pt)

#cv-entry([Zoe Bozich (Masters Student, SDSU)], "2023--2024")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Modeling the Evolution of Accreting Protostars with #smallcaps[mesa]]))
#v(3pt)

#cv-entry([Paarmita Pandey (PhD Student, OSU) #ref-star], "2022--Present")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [_Fermi_ Observations of the Diffuse $gamma$-ray Emission of Young Massive Star Clusters]))
#v(3pt)

#cv-entry([Jennifer Rodriguez (PhD Student, OSU) #ref-star], "2022--Present")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Tracing the Impact of Stellar Wind Feedback in N79 & 30 Doradus in the LMC with Chandra]))
#v(3pt)

#cv-entry([Sabrina Appel (PhD Student, Rutgers; Postdoc, AMNH) #ref-star], "2020--2023")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Effects of B-fields and Feedback on the Shape and Evolution of the Density PDF in Star Formation]))
#v(3pt)

#cv-entry([Grace Olivier (PhD Student, OSU; Postdoc, Texas A&M) #ref-star], "2020--2023")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Evolution of Stellar Feedback in H#sub[II] Regions]))
#v(3pt)

#cv-entry([Michael Foley (PhD Student, Harvard)], "2018--2019")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Blowing Bubbles around Intermediate-Mass Stars: Stellar Wind Feedback is not Enough]))
#v(3pt)

#cv-entry([Hope Chen (PhD, Harvard; Postdoc, UT Austin)], "2018--2019")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Effects of an Embedded B-Star Wind in Ophiuchus]))

#v(4pt)
#cv-subsection("Undergraduate Students")

#cv-entry([Victor Del Rio (SDSU)], "Summer 2025")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [#link("https://www.startastro.org", text(fill: accent, "STARTAstro")) Program (community college transfer student)]))
#v(3pt)

#cv-entry([Edwin Sarabia (SDSU)], "Summer 2025")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [#link("https://www.startastro.org", text(fill: accent, "STARTAstro")) Program (community college transfer student)]))
#v(3pt)

#cv-entry([Alex Escamilla (SDSU) #ref-star], "2024--2026")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Bridging Theory and Observation: Synthetic FIR Insights into Star Formation Efficiency]))
#v(3pt)

#cv-entry([Kate Gonzalez (SDSU)], "2024")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Initial developer of the #smallcaps[Sim2SKIRT] synthetic observation pipeline with #smallcaps[skirt]]))
#v(3pt)

#cv-entry([Trinity Webb (OSU) #ref-star], "2023--2024")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Tracing the Impact of Stellar Wind Feedback in N79 & 30 Doradus in the LMC with Chandra]))
#v(3pt)

#cv-entry([Mikayla Wilson (grad student, UCSC; Banneker Intern, Harvard)], "2020")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Tracing the Evolution of Molecular Outflows in Massive Star Formation with Synthetic Observations]))
#v(3pt)

#cv-entry([Monica Gallegos-Garcia (grad student, Northwestern; Banneker Intern, Harvard) #ref-star], "2018--2020")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Winds in Star Clusters Drive Kolmogorov Turbulence]))
#v(3pt)

#cv-entry([Courtney Bishop (College of William & Mary; SAO NSF REU)], "2018")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Comparing Molecular Line Tracers in Outflows Generated by Massive Star Formation]))
#v(3pt)

#cv-entry([Evan Carter (UCSC; astro masters, Wesleyan)], "2014--2016")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Synthetic Observations of Low-Mass Star Formation: Implications for Current SED-Fitting Methods]))

#v(3pt)
#block(inset: (left: 0pt), text(size: 9pt, fill: secondary,
  [#ref-star Denotes students whose project or contribution led to a refereed publication]))

// ============================================================
// SERVICE EXPERIENCE
// ============================================================
#cv-section("Service Experience")

#cv-subsection("At SDSU (2023–Present)")

#cv-entry([Curriculum Committee], "2024--Present")
#v(2pt)
#cv-entry([UCSD-SDSU Joint Astronomy Colloquium], "2024--Present")
#v(2pt)
#cv-entry([SOC Member, _Ensenada-San Diego Astronomical Meeting_], "2024")
#v(2pt)
#cv-entry([Executive Committee Member, STARTastro Program (NSF-funded)], "2024--Present")
#v(2pt)
#cv-entry([#link("https://calbridge.org/", text(fill: accent, "Cal-Bridge")) _CSU Physics & Astronomy_ Mentor], "2024--Present")

#v(4pt)
#cv-subsection("National & International Service")

#cv-entry([NASA JWST Cycle 5 Panelist], "2026")
#v(2pt)
#cv-entry([Reviewer, NASA FINESST Graduate Fellowship Program], "2025")
#v(2pt)
#cv-entry([Reviewer, NASA Postdoctoral Fellowship Program], "2024")
#v(2pt)
#cv-entry([Reviewer & Panelist, NSF Career Award (Astronomical Sciences Div.)], "2023")
#v(2pt)
#cv-entry([Co-Editor, _Frontiers in Astronomy and Space Sciences_ Research Topics collection on \ #h(12pt) _Star Formation: Numerical Simulations and What They Teach Us_], "2023--2024")
#v(2pt)
#cv-entry([SOC co-chair, #link("https://olympiansymposium.org/", text(fill: accent, "Olympian Symposium 2023: Star Formation in the Era of JWST"))], "2022--2023")
#v(2pt)
#cv-entry([Science Working Group Member, _PRIMA Far-IR Probe Mission Concept_], "2022--")
#v(2pt)
#cv-entry([NASA JWST Cycle 1 Panelist], "2021")
#v(2pt)
#cv-entry([Referee for A&A, ApJ, MNRAS, & RAA], "")

#v(4pt)
#cv-subsection("Before SDSU")

#cv-entry([Harvard Astronomy DEI Committee], "2021--2022")
#v(2pt)
#cv-entry([CfA-IDEA Committee], "2020--2021")
#v(2pt)
#cv-entry([Organizer, CfA Galaxies & Cosmology Seminar], "2019--2021")
#v(2pt)
#cv-entry([Panelist, NASA Theory Astrophysics Program], "2019")
#v(2pt)
#cv-entry([Reviewer, NASA NESSF], "2019")
#v(2pt)
#cv-entry([Organizer, Equity & Inclusion Journal Club, Harvard-Smithsonian CfA], "2018--2019")
#v(2pt)
#cv-entry([Proposal Reviewer, Czech Science Foundation], "2018")
#v(2pt)
#cv-entry([ITC Postdoctoral Fellowship Committee Member, Harvard-Smithsonian CfA], "2017")
#v(2pt)
#cv-entry([SOC/LOC Member (Chair 2019), Harvard-Heidelberg Star Formation Meeting, CfA], "2017, 2019")
#v(2pt)
#cv-entry([Organizer, Diverse Topics in Astronomy Lecture Series, Lamat REU, UCSC], "2015, 2016")
#v(2pt)
#cv-entry([Organizer, Space Telescope Proposal Writing Workshop, UCSC Astro. Dept.], "2015")
#v(2pt)
#cv-entry([Member, LAMAT Research Internship Admissions Committee], "2014")
#v(2pt)
#cv-entry([Undergraduate Student Mentor, UCSC Women in Physics Group], "2013--2017")
#v(2pt)
#cv-entry([Graduate Student Mentor, UCSC Astro. & Astroph. Dept.], "2012--2013, 2016--2017")
#v(2pt)
#cv-entry([Astronomy Grad Student Representative, UCSC GSA], "2012--2013")
#v(2pt)
#cv-entry([Organizer, Applying to the NSF GRFP Workshop, UCSC Astro. Dept.], "2012--2016")

// ============================================================
// TEACHING EXPERIENCE
// ============================================================
#cv-section("Teaching Experience")

#cv-entry([
  #text(font: mono, fill: accent, size: 9.5pt, "ASTR 596")
  #h(4pt)
  #text(font: sans, weight: "semibold", link("https://astrobytes-edu.github.io/astr596-modeling-universe/", text(fill: accent, "Modeling the Universe")))
  #h(4pt)
  #pill("new course development")
], "Fall 2025")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Build glass-box computational models — from stellar dynamics to cosmology — using Python/JAX]))
#v(3pt)

#cv-entry([
  #text(font: mono, fill: accent, size: 9.5pt, "COMP 536")
  #h(4pt)
  #text(font: sans, weight: "semibold", link("https://astrobytes-edu.github.io/comp536-sp26/", text(fill: accent, "Computational Modeling for Scientists")))
  #h(4pt)
  #pill("course modernization")
], "Spring 2025, 2026")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Think computationally: solve differential equations, fit models to data, and write maintainable scientific code]))
#v(3pt)

#cv-entry([
  #text(font: mono, fill: accent, size: 9.5pt, "ASTR 201")
  #h(4pt)
  #text(font: sans, weight: "semibold", link("https://astrobytes-edu.github.io/astr201-sp26/", text(fill: accent, "Astronomy for Science Majors")))
], "Spring 2024, 2025, 2026")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [Observe. Model. Infer. A quantitative approach to decoding what starlight tells us about the universe]))
#v(3pt)

#cv-entry([
  #text(font: mono, fill: accent, size: 9.5pt, "ASTR 101")
  #h(4pt)
  #text(font: sans, weight: "semibold", link("https://astrobytes-edu.github.io/astr101-sp26/", text(fill: accent, "Principles of Astronomy")))
], "Spring 2026")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [How do we know what we know? A guided tour of the universe through the lens of scientific reasoning]))
#v(3pt)

#cv-entry([
  #text(font: mono, fill: accent, size: 9.5pt, "COMP 521")
  #h(4pt)
  #text(font: sans, weight: "semibold", "Introduction to Computational Science")
  #h(4pt)
  #pill("course modernization")
], "Fall 2024")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
  [From scratch to professional practice: numerical methods, data science, and software engineering — all in Python]))
#v(4pt)

// Cosmic Playground — teal card outline
#block(
  width: 100%,
  inset: 10pt,
  radius: 4pt,
  stroke: 1pt + accent,
  {
    cv-entry([
      Developer & Designer, #text(font: sans, weight: "semibold", link("https://astrobytes-edu.github.io/cosmic-playground/", text(fill: accent, "Cosmic Playground")))
      — Interactive Astronomy Demos Platform
    ], "2025--Present")
    block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary, style: "italic",
      [Predict. Play. Explain. — Play with the universe. Learn the physics.]))
  },
)

#v(4pt)
#cv-entry([UCSD Transfer Student Workshop Series, Introduction to Python Programming], "2022")
#v(2pt)
#cv-entry([Guest Lecture, UT Austin Computational Astrophysics & UCSD Radiative Processes], "2022")
#block(inset: (left: 12pt), text(size: 9.5pt, fill: secondary,
  ["Modeling Radiative Feedback in (Massive) Star Formation Simulations"]))
#v(2pt)
#cv-entry([Co-Instructor, Python Programming Bootcamp, Lamat Program, UCSC], "2015")
#v(2pt)
#cv-entry([Activity Designer/Facilitator, ISEE PDP, Hartnell College], "2011")
#v(2pt)
#cv-entry([Teaching Assistant, "Astronomy 2: Overview of the Universe," UCSC], "2010")
#v(2pt)
#cv-entry([Undergraduate Student Instructor, "Astronomy C10: Intro to Astronomy," UC Berkeley], "2009")

// ============================================================
// PROFESSIONAL DEVELOPMENT
// ============================================================
#cv-section("Professional Development")

#cv-entry([AI Ready Course Design Workshop, SDSU Center for Teaching and Learning], "2026")
#v(2pt)
#cv-entry([Diversity & Inclusion Certificate Program, UCSC Office for DEI], "2017")
#v(2pt)
#cv-entry([ISEE PDP for Inquiry-based Education, UCSC], "2011")
#v(2pt)
#cv-entry([Astronomy 300: Instruction Techniques in General Astronomy, UC Berkeley], "2009")

// ============================================================
// REFEREED PUBLICATIONS
// ============================================================
#cv-section("Refereed Publications")

// Helper for a publication entry
#let pub(n, title, authors, journal, url: none, status: none, first-author: false) = {
  let entry-content = {
    grid(
      columns: (26pt, 1fr),
      column-gutter: 6pt,
      pub-number(n),
      {
        text(font: sans, weight: "semibold", size: 10pt, fill: charcoal, title)
        linebreak()
        text(size: 9.5pt, authors)
        linebreak()
        {
          text(size: 9.5pt, fill: secondary, journal)
          if status != none {
            h(6pt)
            if status == "submitted" {
              pill("submitted", color: rgb("#d97706"))
            } else if status == "accepted" {
              pill("accepted", color: accent)
            }
          }
          if url != none {
            ads-link(url)
          }
        }
      },
    )
  }

  if first-author {
    block(
      width: 100%,
      inset: (left: 4pt),
      stroke: (left: 2.5pt + accent),
      entry-content,
    )
  } else {
    entry-content
  }
  v(8pt)
}

#pub(34,
  "Confidently Wrong: Why Ignoring Binaries Biases IMF Inference at Large Sample Sizes",
  [#me("Rosen, A.L.")],
  [_The Astrophysical Journal_],
  status: "submitted",
  first-author: true,
  url: "https://ui.adsabs.harvard.edu/abs/2026arXiv260315779R/abstract",
)

#pub(33,
  "Bridging Theory and Observation: Synthetic Far-infrared Insights into Star Formation Efficiency",
  [Escamilla, A., Grudić, M.Y., #me("Rosen, A.L.")],
  [2026, _The Astrophysical Journal_, 1004, 14],
  url: "https://ui.adsabs.harvard.edu/abs/2026ApJ..1004...14E/abstract",
  first-author: false,
)

#pub(32,
  "Investigating the " + $gamma$ + "-Ray Emission from Explosive Dispersal Outflows with Fermi-LAT",
  [Pandey, P., Lenker, S.C., Lopez, L.A., #me("Rosen, A.L."), Linden, T., Thompson, T.A., Offner, S.S.R., Auchettl, K., Hirata, C.M.],
  [2026, _The Astrophysical Journal_, 1000, 102],
  url: "https://ui.adsabs.harvard.edu/abs/2026ApJ..1000..102P/abstract",
)

#pub(31,
  "Taming the Tarantula: How Stellar Wind Feedback Shapes Gas and Dust in 30 Doradus",
  [Rodriguez, J.A., Lopez, L.A., Lancaster, L., #me("Rosen, A.L."), Nayak, O., Lopez, S., Holland-Ashford, T., Webb, T.L.],
  [2026, _The Astrophysical Journal_, 998, 318],
  url: "https://ui.adsabs.harvard.edu/abs/2026ApJ...998..318R",
)

#pub(30,
  "The HADES Simulations: I. Impact of Protostellar Magnetic Fields on the Accretion Modes",
  [Gaches, B.A.L., Tan, J.C., #me("Rosen, A.L."), Kuiper, R.],
  [2024, _Astronomy & Astrophysics_, 692, A219],
  url: "https://ui.adsabs.harvard.edu/abs/2024A&A...692A.219G/abstract",
)

#pub(29,
  "FORGE'd in FIRE III: The IMF in Quasar Accretion Disks from STARFORGE",
  [Hopkins, P.F., Grudić, M.Y., Kremer, K., Offner, S.S.R., Guszejnov, D., #me("Rosen, A.L.")],
  [2024, _The Open Journal of Astrophysics_, 7, 71],
  url: "https://ui.adsabs.harvard.edu/abs/2024OJAp....7E..71H/abstract",
)

#pub(28,
  "Constraining the Diffusion Coefficient and Cosmic-Ray Acceleration Efficiency Using Gamma-Ray Emission from RCW 38",
  [Pandey, P., Lopez, L.A., #me("Rosen, A.L."), Thompson, T.A., Linden, T., Blackstone, I.],
  [2024, _The Astrophysical Journal_, 976, 98],
  url: "https://ui.adsabs.harvard.edu/abs/2024ApJ...976...98P/abstract",
)

#pub(27,
  "Detection of Diffuse Hot Gas Around the Young, Potential Superstar Cluster H72.97-69.39",
  [Webb, T.L., Rodriguez, J.A., Lopez, L.A., #me("Rosen, A.L."), Lancaster, L., Nayak, O., McLeod, A.F., Pandey, P., Olivier, G.M.],
  [2024, _The Astrophysical Journal_, 977, 45],
  url: "https://ui.adsabs.harvard.edu/abs/2024ApJ...977...45W/abstract",
)

#pub(26,
  "Stellar populations in STARFORGE: the origin and evolution of star clusters and associations",
  [Farias, J.P., Offner, S.S.R., Grudić, M.Y., Guszejnov, D., #me("Rosen, A.L.")],
  [2024, _MNRAS_, 527, 6732],
  url: "https://ui.adsabs.harvard.edu/abs/2024MNRAS.527.6732F/abstract",
)

#pub(25,
  "What Sets the Star Formation Rate of Molecular Clouds? The Density Distribution as a Fingerprint of Compression and Expansion Rates",
  [Appel, S.M., Burkhart, B., Semenov, V.A., Federrath, C., #me("Rosen, A.L."), Tan, J.C.],
  [2023, _The Astrophysical Journal_, 954, 93],
  url: "https://ui.adsabs.harvard.edu/abs/2023ApJ...954...93A/abstract",
)

#pub(24,
  "The TEMPO Survey I: Predicting Yields of Transiting Exosatellites, Moons, and Planets from a 30-day Survey of Orion with Roman",
  [Limbach, M.A., Soares-Furtado, M., Vanderburg, A., Best, W.J., Cody, A.M., D'Onghia, E., Heller, R., Hensley, B.S., Kounkel, A., Kraus, A., Mann, A.W., Robberto, M., #me("Rosen, A.L."), Townsend, R., Vos, J.M.],
  [2023, _PASP_, 135, 1043],
  url: "https://ui.adsabs.harvard.edu/abs/2023PASP..135a4401L/abstract",
)

#pub(23,
  "Effects of the environment on the multiplicity properties of stars in the STARFORGE simulations",
  [Guszejnov, D., Raju, A.N., Offner, S.S.R., Grudić, M.Y., Faucher-Giguère, C., Hopkins, P.F., #me("Rosen, A.L.")],
  [2023, _MNRAS_, 518, 4693],
  url: "https://ui.adsabs.harvard.edu/abs/2023MNRAS.518.4693G/abstract",
)

#pub(22,
  "A Massive Star is Born: How Feedback from Stellar Winds, Radiation Pressure, and Collimated Outflows Limits Accretion onto Massive Stars",
  [#me("Rosen, A.L.")],
  [2022, _The Astrophysical Journal_, 941, 202],
  url: "https://ui.adsabs.harvard.edu/abs/2022ApJ...941..202R/abstract",
  first-author: true,
)

#pub(21,
  "Dust in the Wind with Resonant Drag Instabilities: I. The Dynamics of Dust-Driven Outflows in GMCs and H II Regions",
  [Hopkins, P.F., #me("Rosen, A.L."), Squire, J., Panopoulou, G.V., Soliman, N.H., Seligman, D., Steinwandel, U.P.],
  [2022, _MNRAS_, 517, 1491],
  url: "https://ui.adsabs.harvard.edu/abs/2021arXiv210704608H/abstract",
)

#pub(20,
  "Effects of the environment and feedback physics on the IMF of stars in the STARFORGE simulations",
  [Guszejnov, D., Grudić, M.Y., Offner, S.S.R., Faucher-Giguère, C., Hopkins, P.F., #me("Rosen, A.L.")],
  [2022, _MNRAS_, 515, 4929],
  url: "https://ui.adsabs.harvard.edu/abs/2022MNRAS.515.4929G/abstract",
)

#pub(19,
  "Cluster assembly and the origin of mass segregation in the STARFORGE simulations",
  [Guszejnov, D., Markey, C., Offner, S.S.R., Grudić, M.Y., Faucher-Giguère, C., #me("Rosen, A.L."), Hopkins, P.F.],
  [2022, _MNRAS_, 515, 167],
  url: "https://ui.adsabs.harvard.edu/abs/2022MNRAS.515..167G/abstract",
)

#pub(18,
  "The dynamics and outcome of star formation with jets, radiation, winds, and supernovae in concert",
  [Grudić, M.Y., Guszejnov, D., Offner, S.S.R., #me("Rosen, A.L."), Raju, A.N., Faucher-Giguère, C., Hopkins, P.F.],
  [2022, _MNRAS_, 512, 216],
  url: "https://ui.adsabs.harvard.edu/abs/2022arXiv220100882G/abstract",
)

#pub(17,
  "Less wrong: a more realistic initial condition for simulations of turbulent molecular clouds",
  [Lane, H.B., Grudić, M.Y., Guszejnov, D., Offner, S.S.R., Faucher-Giguère, C., #me("Rosen, A.L.")],
  [2022, _MNRAS_, 510, 4767],
  url: "https://ui.adsabs.harvard.edu/abs/2022MNRAS.510.4767L/abstract",
)

#pub(16,
  "ORION2: A magnetohydrodynamics code for star formation",
  [Li, P.S., Cunningham, A.J., Gaches, B.L., Klein, R.I., Krumholz, M.R., Lee, A.T., McKee, C.F., Offner, S.S.R., #me("Rosen, A.L."), Skinner, M.A.],
  [_Journal of Open Source Software_],
  url: "https://joss.theoj.org/papers/10.21105/joss.03771",
)

#pub(15,
  "The Effects of Magnetic Fields and Outflow Feedback on the Shape and Evolution of the Density PDF in Turbulent Star-Forming Clouds",
  [Appel, S.M., Burkhart, B., Semenov, V.A., Federrath, C., #me("Rosen, A.L.")],
  [2022, _The Astrophysical Journal_, 927, 75],
  url: "https://ui.adsabs.harvard.edu/abs/2021arXiv210913271A/abstract",
)

#pub(14,
  "Observations of the Ag(3" + $times$ + "1) Phase on Ge(111)",
  [Mullet, C.H., #me("Rosen, A.L."), Chiang, S.],
  [2021, _Journal of Vacuum Science & Technology A_, 39, Issue 5],
  url: "https://ui.adsabs.harvard.edu/abs/2021JVSTA..39e3207M/abstract",
)

#pub(13,
  "Evolution of Stellar Feedback in H II Regions",
  [Olivier, G.M., Lopez, L.A., #me("Rosen, A.L."), Nayak, O., Reiter, M., Krumholz, M.R., Bolatto, A.D.],
  [2021, _The Astrophysical Journal_, 908, 68],
  url: "https://ui.adsabs.harvard.edu/abs/2021ApJ...908...68O/abstract",
)

#pub(12,
  "Continuity of Accretion from Clumps to Class 0 High-Mass Protostars",
  [Avison, A., Fuller, G.A., Peretto, N., Duarte-Cabral, A., #me("Rosen, A.L."), Traficante, A., Pineda, J.E., Güsten, R., Cunningham, N.],
  [2021, _Astronomy & Astrophysics_, 645, A142],
  url: "https://ui.adsabs.harvard.edu/abs/2021A%26A...645A.142A/abstract",
)

#pub(11,
  "Winds in Star Clusters Drive Kolmogorov Turbulence",
  [Gallegos-Garcia, M., Burkhart, B., #me("Rosen, A.L."), Naiman, J.P., Ramirez-Ruiz, E.],
  [2020, _ApJ Letters_, 899, 30],
  url: "https://ui.adsabs.harvard.edu/abs/2020ApJ...899L..30G/abstract",
)

#pub(10,
  "The Role of Outflows, Radiation Pressure, and Magnetic Fields in Massive Star Formation",
  [#me("Rosen, A.L."), Krumholz, M.R.],
  [2020, _Astronomical Journal_, 160, 78],
  url: "https://ui.adsabs.harvard.edu/abs/2020AJ....160...78R/abstract",
  first-author: true,
)

#pub(9,
  "Zooming in on Individual Star Formation: Low- and High-mass Stars",
  [#me("Rosen, A.L."), Offner, S.S.R., Sadavoy, S.I., Bhandare, A., Vázquez-Semadeni, E., Ginsburg, A.],
  [2020, _Space Science Reviews_, 216, 62],
  url: "https://ui.adsabs.harvard.edu/abs/2020SSRv..216...62R/abstract",
  first-author: true,
)

#pub(8,
  "Formation and Evolution of Disks Around Young Stellar Objects",
  [Zhao, B., Tomida, K., Hennebelle, P., Tobin, J.J., Maury, A., Hirota, T., Sánchez-Monge, Á., Kuiper, R., #me("Rosen, A."), Bhandare, A., Padovani, M., Lee, Y.],
  [2020, _Space Science Reviews_, 216, 43],
  url: "https://ui.adsabs.harvard.edu/abs/2020SSRv..216...43Z/abstract",
)

#pub(7,
  "Circumbinary Disks: Accretion and Torque as a Function of Mass Ratio and Disk",
  [Duffell, P.C., D'Orazio, D., Derdzinski, A., Haiman, Z., MacFayden, A., #me("Rosen, A.L."), Zrake, J.],
  [2020, _The Astrophysical Journal_, 901, 25],
  url: "https://ui.adsabs.harvard.edu/abs/2020ApJ...901...25D/abstract",
)

#pub(6,
  "Massive Star Formation via the Collapse of Subvirial and Virialized Turbulent Massive Cores",
  [#me("Rosen, A.L."), Li, P.S., Zhang, Q., Burkhart, B.],
  [2019, _The Astrophysical Journal_, 887, 108],
  url: "https://ui.adsabs.harvard.edu/abs/2019ApJ...887..108R/abstract",
  first-author: true,
)

#pub(5,
  [unyt: Handle, manipulate, and convert data with units in Python],
  [Goldbaum, N.J., ZuHone, J.A., Turk, M.J., Kowalik, K., #me("Rosen, A.L.")],
  [2018, _Journal of Open Source Software_, 3, 28, 809],
  url: "http://adsabs.harvard.edu/abs/2018arXiv180602417G",
)

#pub(4,
  [HARM#super("2"): A Highly Parallel Method for Radiation Hydrodynamics on Adaptive Grids],
  [#me("Rosen, A.L."), Krumholz, M.R., Oishi, J.S., Lee, A.T., Klein, R.I.],
  [2017, _Journal of Computational Physics_, 330, 924],
  url: "http://adsabs.harvard.edu/abs/2017JCoPh.330..924R",
  first-author: true,
)

#pub(3,
  "An Unstable Truth: How Massive Stars get their Mass",
  [#me("Rosen, A.L."), Krumholz, M.R., McKee, C.F., Klein, R.I.],
  [2016, _MNRAS_, 463, 2553],
  url: "http://adsabs.harvard.edu/abs/2016MNRAS.463.2553R",
  first-author: true,
)

#pub(2,
  "Gone with the Wind: Where is the Missing Stellar Wind Energy from Massive Star Clusters?",
  [#me("Rosen, A.L."), Lopez, L.A., Krumholz, M.R., Ramirez-Ruiz, E.],
  [2014, _MNRAS_, 442, 2701],
  url: "http://adsabs.harvard.edu/abs/2014MNRAS.442.2701R",
  first-author: true,
)

#pub(1,
  "What Sets the Initial Rotation Rates of Massive Stars?",
  [#me("Rosen, A.L."), Krumholz, M.R., Ramirez-Ruiz, E.],
  [2012, _The Astrophysical Journal_, 748, 97],
  url: "http://adsabs.harvard.edu/abs/2012ApJ...748...97R",
  first-author: true,
)

// ============================================================
// SCIENTIFIC PRESENTATIONS
// ============================================================
#cv-section("Scientific Presentations")

// Stats callout box
#block(
  width: 100%,
  inset: 10pt,
  radius: 4pt,
  fill: bg-subtle,
  stroke: (left: 3pt + accent),
  {
    grid(
      columns: (auto, 8pt, auto),
      {
        text(font: sans, size: 20pt, weight: "bold", fill: accent, "55")
        text(font: sans, size: 10pt, fill: charcoal, " invited talks")
      },
      [],
      {
        text(font: sans, size: 20pt, weight: "bold", fill: accent, "36")
        text(font: sans, size: 10pt, fill: charcoal, " contributed talks")
      },
    )
  },
)

#v(4pt)
#text(size: 10pt, fill: body-color, [Selected presentations:])
#v(3pt)

#cv-entry([Invited Talk, _Star Formation, Stellar Feedback, and the Ecology of Galaxies_; Visegrad, Hungary], "2025")
#v(2pt)
#cv-entry([Invited Talk, _TOSCA — Topical Overview on Star Cluster Astrophysics_; Siena, Italy], "2024")
#v(2pt)
#cv-entry([Invited Talk, _The Fullness of Space: Celebrating the Career of Christopher F. McKee_; Berkeley, CA], "2024")
#v(2pt)
#cv-entry([Invited Colloquium, Simons Center for Computational Astrophysics; New York, NY], "2024")
#v(2pt)
#cv-entry([Keynote Speaker, Cal-Poly Pomona's Annual _Women in Physics_ Seminar; Pomona, CA], "2024")
#v(2pt)
#cv-entry([Invited Colloquium, University of Indiana Astronomy Colloquium], "2024")
#v(2pt)
#cv-entry([Invited Colloquium, CSU Los Angeles Physics & Astronomy Colloquium], "2023")
#v(2pt)
#cv-entry([Invited Talk, _Resolving Galaxy Ecosystems Across All Scales_; Sha Tin, NT, Hong Kong], "2023")
#v(2pt)
#cv-entry([Invited Colloquium, Johns Hopkins University / STScI; Baltimore, MD], "2023")
#v(2pt)
#cv-entry([Invited Colloquium, UC Davis Physics & Astronomy Colloquium; Davis, CA], "2023")
#v(2pt)
#cv-entry([Invited Colloquium, University of Hawaii Manoa Institute of Astronomy; Honolulu, HI], "2023")
#v(2pt)
#cv-entry([Invited Colloquium, University of Arizona & Steward Observatory; Tucson, AZ], "2023")
#v(2pt)
#cv-entry([Invited Colloquium, SDSU Computational Sciences Research Center; San Diego, CA], "2023")
#v(2pt)
#cv-entry([Invited Keynote, Science with the Line Emission Mapper; Harvard-Smithsonian CfA], "2023")
#v(2pt)
#cv-entry([Invited Colloquium, OSU Astronomy Department; Columbus, OH], "2022 & 2023")
#v(2pt)
#cv-entry([Invited Colloquium, University of Oregon Physics Department; Eugene, OR], "2023")
#v(2pt)
#cv-entry([Invited Talk, IAU Challenges & Innovations in Computational Astrophysics], "2022")
#v(2pt)
#cv-entry([Invited Seminar, UC San Diego Astronomy Seminar; La Jolla, CA], "2022")
#v(2pt)
#cv-entry([Invited Seminar, Canadian Institute for Theoretical Astrophysics; Toronto, Canada], "2022")
#v(2pt)
#cv-entry([Invited Colloquium, Durham University Astronomy Department; Durham, UK], "2022")
#v(2pt)
#cv-entry([Invited Colloquium, Carnegie Observatories; Pasadena, CA], "2021")
#v(2pt)
#cv-entry([Invited NSF REU Colloquium, CfA | Harvard & Smithsonian; Cambridge, MA], "2021")
#v(2pt)
#cv-entry([Invited Colloquium, Caltech Astronomy Colloquium; Pasadena, CA], "2021")
#v(2pt)
#cv-entry([Invited Colloquium, Royal Observatory of Edinburgh; Edinburgh, Scotland], "2021")
#v(2pt)
#cv-entry([Invited Colloquium, Rice University Physics & Astronomy Department; Houston, TX], "2021")
#v(2pt)
#cv-entry([Invited Colloquium, University of Chicago Astronomy & Astrophysics Dept.; Chicago, IL], "2021")
#v(2pt)
#cv-entry([Invited Review Talk, Radiation Hydrodynamics: Implementation & Application; RAS, London, UK], "2020")
#v(2pt)
#cv-entry([Invited Review Talk, ISSI Star Formation Workshop; Bern, Switzerland], "2019")
#v(2pt)
#cv-entry([Invited Talk, Gas Fueling of Galaxy Structures, Astro 3D; Barossa Valley, Australia], "2018")
#v(2pt)
#cv-entry([Invited Colloquium, University of Florida Astronomy Department; Gainesville, FL], "2018")
#v(2pt)
#cv-entry([Invited Review Talk, Stars Birth & Death: GMT Community Science Meeting; Honolulu, HI], "2018")
#v(2pt)
#cv-entry([Invited Talk, Astrophysical Shocks Meeting, AIP Potsdam; Potsdam, Germany], "2018")
#v(2pt)
#cv-entry([Invited Colloquium, Dept. of Astronomy, UMass Amherst; Amherst, MA], "2017")

// ============================================================
// PUBLIC OUTREACH
// ============================================================
#cv-section("Public Outreach")

#cv-entry([Speaker, Sharp Minds Public Lecture Series, Fleet Science Center, San Diego, CA], "2025")
#v(2pt)
#cv-entry([Panelist/Speaker, NASA Community College Symposium, Fleet Science Center, San Diego, CA], "2024")
#v(2pt)
#cv-entry([SDSU Astronomy Expert, Solar Eclipse Event, Fleet Science Center, San Diego, CA], "2024")
#v(2pt)
#cv-entry([Speaker, "Women and Non-binary in STEM" Series, San Diego Miramar College (SDCCD)], "2023")
#v(2pt)
#cv-entry([AAUW STEM Ambassador, #link("https://www.aauw.org/resources/programs/stemed-for-girls/", text(fill: accent, "AAUW STEMEd for Girls program"))], "2022")
#v(2pt)
#cv-entry([Speaker, "How to Make Massive Stars on a (super)Computer," Western Nevada College / NCCN], "2022")
#v(2pt)
#cv-entry([Science Matter Expert, NASA Community College Network (NCCN)], "2021--Present")
#v(2pt)
#cv-entry([Panelist, Astronomy Career Panel, Girls Inc., Lynn, MA], "2021")
#v(2pt)
#cv-entry([Panelist, "Meet a Scientist" Panel for Women's History Month, Marin Community College], "2021")
#v(2pt)
#cv-entry([Panelist, "Writing an Effective Proposal" presented to Harvard Graduate Students], "2020")
#v(2pt)
#cv-entry([Interviewee, "How to Make Stars on a (super)Computer," Astrochats / MicroObservatory #h(4pt) #link("https://youtu.be/JEOY4z0KgAU", box(inset: (x: 4pt, y: 1pt), radius: 4pt, fill: accent, text(font: sans, size: 7pt, fill: white, weight: "bold", "▶ YouTube")))], "2020")
#v(2pt)
#cv-entry([Speaker, "How to Make Massive Stars on a (super)Computer," Astronomy on Tap Boston], "2020")
#v(2pt)
#cv-entry([Presenter, "Visualizing Numerical Simulations with _yt_," CfA | Harvard & Smithsonian _Demofest_], "2019")
#v(2pt)
#cv-entry([Speaker, "How to Make Stars on a (super)Computer," WiSE Science on Tap], "2017")
#v(2pt)
#cv-entry([Speaker, "An Unstable Truth: How Massive Stars get their Mass," AAUW Monterey Peninsula], "2017")
#v(2pt)
#cv-entry([Speaker, "How to Write an Effective Abstract," Lamat REU Program, UCSC], "2016")
#v(2pt)
#cv-entry([Organizer/Panelist, "Astronomy Grad Student & Post-doc Panel," Lamat REU, UCSC], "2016")
#v(2pt)
#cv-entry([Speaker, "Then and Now: From NHP to a Ph.D. in Astrophysics," North Hills Prep School], "2016")
#v(2pt)
#cv-entry([Astronomy Outreach, Expanding Your Horizons Workshop for Young Girls, Hartnell College], "2015")
#v(2pt)
#cv-entry([Speaker, "How to Make Stars on a (super)Computer," UCSC / Monterey Astro. Club / Scotts Valley HS], "2015")
#v(2pt)
#cv-entry([Speaker, "Computational Astrophysics," Stanford Pre-collegiate Summer Courses], "2015")
#v(2pt)
#cv-entry([Speaker, "Star Formation and Stellar Feedback," Lamat REU, UCSC], "2015, 2016")
#v(2pt)
#cv-entry([Speaker, "Reading Scientific Literature," Lamat REU, UCSC], "2015")
#v(2pt)
#cv-entry([Grad Student Panelist, AVID Program, Soquel HS], "2015")
#v(2pt)
#cv-entry([WiSE Astronomy Education Outreach Talk, Seaside HS], "2014")
#v(2pt)
#cv-entry([Panelist, STEM Diversity Professional Development Workshop Series, UCSC], "2014")
#v(2pt)
#cv-entry([Author, #link("https://astrobites.org/", text(fill: accent, "astrobites.org")) (#link("https://astrobites.org/author/annarosen84/", text(fill: accent, "articles")))], "2011--2013")
#v(2pt)
#cv-entry([WiSE Education Outreach Presentation, Santa Cruz HS], "2011")
#v(2pt)
#cv-entry([Panelist, Girl Scouts _Girls Go Tech_ Event, NASA Ames, Moffett Field, CA], "2011")
