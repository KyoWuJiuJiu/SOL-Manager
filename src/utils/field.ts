import type { FieldKey } from "../config/fields";
import { normalizeFieldName } from "./strings";

export interface FieldMetaLike {
  id: string;
  name: string;
  type?: number;
}

export function getFieldIdByName(
  fieldMetas: FieldMetaLike[],
  name: string,
  expectType?: number
): string | undefined {
  const normalizedTarget = normalizeFieldName(name);
  let candidate = fieldMetas.find((meta) => {
    const matchesName = normalizeFieldName(meta.name) === normalizedTarget;
    if (!matchesName) return false;
    if (expectType == null) return true;
    return meta.type === expectType;
  });

  if (!candidate && expectType != null) {
    candidate = fieldMetas.find((meta) => meta.type === expectType);
  }

  return candidate?.id;
}

export type FieldIdMap = Record<FieldKey, string>;
