export function normalizeFieldName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}
