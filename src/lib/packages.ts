/*
 * packages.ts — the one way to read the Jaxstro package collection.
 *
 * Package data used to live in src/data/jaxstro.ts. It now lives in
 * src/content/packages/*.mdx so each package can carry real prose that grows
 * as its methods paper lands. That module keeps only presentation constants
 * (readiness labels, status labels) — no data — so there is a single source of
 * truth and the ecosystem diagram, the index, the CV and the detail pages
 * cannot drift apart.
 */
import { getCollection, type CollectionEntry } from "astro:content";

export type PackageEntry = CollectionEntry<"packages">;

/** All packages in pipeline order: 0 is the foundation, 1..n the stages. */
export async function getPackages(): Promise<PackageEntry[]> {
  const all = await getCollection("packages", ({ data }) => !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order);
}

/*
 * A step in the pipeline: one package, or two that are coupled.
 *
 * The diagram draws steps, not packages, so the coupling is read from the
 * collection rather than hard-coded into the markup. Nothing downstream has to
 * know WHICH packages are coupled — only that a step may hold two.
 */
export type PipelineStep = PackageEntry[];

/*
 * Group the ordered stages into steps, collapsing each coupled pair into one.
 *
 * Throws rather than rendering something plausible-but-wrong: a coupling that
 * is one-sided, dangling, or split across the sequence would draw a pair in one
 * place and a lone stage in another, and both would look deliberate.
 */
function toSteps(stages: PackageEntry[]): PipelineStep[] {
  const byName = new Map(stages.map((p) => [p.data.name, p]));

  for (const p of stages) {
    const partnerName = p.data.coupledWith;
    if (!partnerName) continue;
    const partner = byName.get(partnerName);
    if (!partner) {
      throw new Error(
        `${p.data.name} is coupledWith "${partnerName}", which is not a pipeline ` +
          `package. Fix the name in src/content/packages/${p.id}.mdx.`,
      );
    }
    if (partner.data.coupledWith !== p.data.name) {
      throw new Error(
        `Coupling is not symmetric: ${p.data.name} names ${partnerName}, but ` +
          `${partnerName} names ${partner.data.coupledWith ?? "nothing"}. Set ` +
          `coupledWith: "${p.data.name}" in src/content/packages/${partner.id}.mdx.`,
      );
    }
    if (Math.abs(p.data.order - partner.data.order) !== 1) {
      throw new Error(
        `${p.data.name} and ${partnerName} are coupled but not adjacent ` +
          `(order ${p.data.order} and ${partner.data.order}). A coupled pair is ` +
          `drawn as one step, so the two must sit next to each other in flow order.`,
      );
    }
  }

  const steps: PipelineStep[] = [];
  for (let i = 0; i < stages.length; i += 1) {
    const here = stages[i]!;
    const next = stages[i + 1];
    if (next && here.data.coupledWith === next.data.name) {
      steps.push([here, next]);
      i += 1; // the partner is consumed by this step
    } else {
      steps.push([here]);
    }
  }
  return steps;
}

/** The foundation (order 0) and the pipeline stages, split for layout. */
export async function getPipeline(): Promise<{
  foundation: PackageEntry | undefined;
  stages: PackageEntry[];
  steps: PipelineStep[];
}> {
  const all = await getPackages();
  const stages = all.filter((p) => p.data.order > 0);
  return {
    foundation: all.find((p) => p.data.order === 0),
    stages,
    steps: toSteps(stages),
  };
}

/*
 * The pipeline as one line of prose: "Birth → stellar evolution ↔ collisional
 * dynamics → observables → …". Derived from the same steps the diagram draws,
 * so the sentence cannot describe a different chain than the picture above it.
 */
export function chainSummary(steps: PipelineStep[]): string {
  return steps
    .map((step) => step.map((p) => p.data.stage.toLowerCase()).join(" ↔ "))
    .join(" → ");
}

/** Route for a package's detail page. */
export const packageHref = (p: PackageEntry) => `/software/${p.id}`;
