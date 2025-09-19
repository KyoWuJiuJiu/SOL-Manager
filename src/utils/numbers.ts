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
    const maybeNumber = (cellValue as { value?: unknown }).value;
    if (typeof maybeNumber === "number" && Number.isFinite(maybeNumber)) return maybeNumber;
  }
  return null;
}
