export type ArrangementCounts = [number, number, number];

export interface ArrangementInput {
  width: number;
  depth: number;
  height: number;
}

export interface ArrangementResult {
  width: number;
  depth: number;
  height: number;
  cubeFeet: number;
  counts: ArrangementCounts;
}

function uniquePermutations(triple: ArrangementCounts): ArrangementCounts[] {
  const indices: ArrangementCounts[] = [
    [triple[0], triple[1], triple[2]],
    [triple[0], triple[2], triple[1]],
    [triple[1], triple[0], triple[2]],
    [triple[1], triple[2], triple[0]],
    [triple[2], triple[0], triple[1]],
    [triple[2], triple[1], triple[0]],
  ];
  const seen = new Set<string>();
  const results: ArrangementCounts[] = [];
  for (const perm of indices) {
    const key = perm.join("x");
    if (!seen.has(key)) {
      seen.add(key);
      results.push(perm);
    }
  }
  return results;
}

function generateFactorTriples(quantity: number): ArrangementCounts[] {
  const triples = new Set<string>();
  const results: ArrangementCounts[] = [];
  const absQty = Math.floor(Math.abs(quantity));
  if (absQty <= 0) return results;

  for (let a = 1; a <= absQty; a += 1) {
    if (absQty % a !== 0) continue;
    const quotient = absQty / a;
    for (let b = 1; b <= quotient; b += 1) {
      if (quotient % b !== 0) continue;
      const c = quotient / b;
      const base: ArrangementCounts = [a, b, c];
      for (const perm of uniquePermutations(base)) {
        const key = perm.join("x");
        if (!triples.has(key)) {
          triples.add(key);
          results.push(perm);
        }
      }
    }
  }
  return results;
}

export function computeBestArrangement(
  quantity: number,
  dims: ArrangementInput,
  bufferInch: number,
  overlap?: Partial<ArrangementInput>
): ArrangementResult | null {
  const triples = generateFactorTriples(quantity);
  if (!triples.length) return null;

  const MAX_DIM_INCH = 21;

  let best: ArrangementResult | null = null;
  for (const counts of triples) {
    const [countW, countD, countH] = counts;
    const overlapWidth = overlap?.width ?? 0;
    const overlapDepth = overlap?.depth ?? 0;
    const overlapHeight = overlap?.height ?? 0;

    const netWidth = countW * dims.width - overlapWidth * Math.max(countW - 1, 0);
    const netDepth = countD * dims.depth - overlapDepth * Math.max(countD - 1, 0);
    const netHeight = countH * dims.height - overlapHeight * Math.max(countH - 1, 0);

    if (!Number.isFinite(netWidth) || !Number.isFinite(netDepth) || !Number.isFinite(netHeight)) {
      continue;
    }
    if (netWidth <= 0 || netDepth <= 0 || netHeight <= 0) {
      continue;
    }

    const width = netWidth + bufferInch;
    const depth = netDepth + bufferInch;
    const height = netHeight + bufferInch;
    if (
      [width, depth, height].some(
        (value) =>
          !Number.isFinite(value) || value <= 0 || value > MAX_DIM_INCH
      )
    ) {
      continue;
    }
    const cubeFeet = (width * depth * height) / 1728;
    if (!best || cubeFeet < best.cubeFeet) {
      best = { width, depth, height, cubeFeet, counts };
    }
  }
  return best;
}
