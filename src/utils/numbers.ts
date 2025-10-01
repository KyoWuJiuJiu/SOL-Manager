export function convertBufferToInches(value: number, unit: "inch" | "cm"): number {
  const CM_PER_INCH = 2.54;
  if (!Number.isFinite(value)) return 0;
  return unit === "cm" ? value / CM_PER_INCH : value;
}

export function round(value: number, fractionDigits = 2): number {
  const factor = 10 ** fractionDigits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function extractNumber(cellValue: unknown): number | null {
  if (cellValue == null) return null;
  if (typeof cellValue === "number" && Number.isFinite(cellValue)) return cellValue;
  if (typeof cellValue === "string") {
    const parsed = Number(cellValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof cellValue === "object") {
    const candidate = cellValue as { value?: unknown; text?: unknown };
    const rawValue =
      typeof candidate.value === "number" && Number.isFinite(candidate.value)
        ? candidate.value
        : typeof candidate.value === "string"
        ? Number(candidate.value)
        : typeof candidate.text === "number" && Number.isFinite(candidate.text)
        ? candidate.text
        : typeof candidate.text === "string"
        ? Number(candidate.text)
        : null;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return rawValue;
    }
  }
  return null;
}
