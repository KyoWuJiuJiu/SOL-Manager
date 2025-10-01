import type { FieldKey } from "../config/fields";
import { normalizeFieldName } from "./strings";

export interface FieldMetaLike {
  id: string;
  name: string;
  type?: number;
}

export function findFieldMetaByName(
  fieldMetas: FieldMetaLike[],
  name: string,
  expectType?: number
): FieldMetaLike | undefined {
  const normalizedTarget = normalizeFieldName(name);
  let fallback: FieldMetaLike | undefined;

  for (const meta of fieldMetas) {
    if (normalizeFieldName(meta.name) !== normalizedTarget) continue;
    if (expectType == null || meta.type === expectType) {
      return meta;
    }
    if (!fallback) {
      fallback = meta;
    }
  }

  return fallback;
}

export function getFieldIdByName(
  fieldMetas: FieldMetaLike[],
  name: string,
  expectType?: number
): string | undefined {
  return findFieldMetaByName(fieldMetas, name, expectType)?.id;
}

export type FieldIdMap = Record<FieldKey, string>;
