import { bitable, FieldType, ToastType } from "@lark-base-open/js-sdk";
import type { PluginContext } from "./context";
import type { FieldIds, FieldKey, OptionalFieldKey } from "../config/fields";
import { FIELD_KEYS, OPTIONAL_FIELD_KEYS } from "../config/fields";
import { computeBestArrangement, type ArrangementResult } from "./arrangement";
import { convertBufferToInches, extractNumber, round } from "../utils/numbers";
import { logError } from "../utils/logger";
import { mapPermissionError } from "../utils/errors";

export type BufferUnit = "inch" | "cm";
export type InnerMaterial = "Box" | "Poly Bag";

const INNER_BOX_PACKAGING_WEIGHT_G = 100;
const GRAM_TO_POUND = 0.00220462;
const LB_TO_KG = 0.4536;
const CDU_BUFFER_CM = 0.5;
const INNER_FIELD_KEYS = [
  "innerWidth",
  "innerDepth",
  "innerHeight",
  "innerWeight",
] as const;
type InnerFieldKey = (typeof INNER_FIELD_KEYS)[number];

export interface CalculationOptions {
  forceAll: boolean;
  innerBuffer: number;
  innerBufferUnit: BufferUnit;
  masterBuffer: number;
  masterBufferUnit: BufferUnit;
  innerMaterial: InnerMaterial;
  overlapHeight: number;
  overlapWidth: number;
  overlapDepth: number;
  overlapUnit: BufferUnit;
  onLog: (message: string) => void;
}

export interface CduCalculationOptions {
  recordIds: string[];
  widthCount: number;
  depthCount: number;
  heightCount: number;
  masterBuffer: number;
  masterBufferUnit: BufferUnit;
  overlapWidth: number;
  overlapDepth: number;
  overlapHeight: number;
  overlapUnit: BufferUnit;
  onLog: (message: string) => void;
}

function isPositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function computeInnerGrossWeightLb(
  innerQty: number,
  itemWeight: number | null,
  innerMaterial: InnerMaterial
): number | null {
  if (innerQty <= 0) return null;
  if (!isPositive(itemWeight)) return null;
  const packagingWeight =
    innerMaterial === "Poly Bag" ? 0 : INNER_BOX_PACKAGING_WEIGHT_G;
  const totalGrams = innerQty * (itemWeight as number) + packagingWeight;
  return totalGrams * GRAM_TO_POUND;
}

function extractTextValue(cellValue: unknown): string | null {
  if (cellValue == null) return null;
  if (typeof cellValue === "number" && Number.isFinite(cellValue)) {
    return String(cellValue);
  }
  if (typeof cellValue === "string") {
    const trimmed = cellValue.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof cellValue === "object") {
    const { text, value } = cellValue as { text?: unknown; value?: unknown };
    const textCandidate =
      typeof text === "string"
        ? text
        : typeof text === "number" && Number.isFinite(text)
        ? String(text)
        : typeof value === "string"
        ? value
        : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : null;
    if (typeof textCandidate === "string") {
      const trimmed = textCandidate.trim();
      return trimmed.length ? trimmed : null;
    }
  }
  return null;
}

function formatRecordLabel(
  recordId: string,
  index: number,
  itemCode: string | null
): string {
  const display =
    itemCode && itemCode.trim().length ? itemCode.trim() : recordId;
  return `#${index + 1} (${display})`;
}

function normaliseIds(list: (string | undefined)[]): string[] {
  return list.filter((id): id is string => Boolean(id));
}

export async function runCalculation(
  context: PluginContext,
  options: CalculationOptions
): Promise<void> {
  const { table, view, fieldIds, fieldMetaMap } = context;
  const {
    forceAll,
    innerBuffer,
    innerBufferUnit,
    masterBuffer,
    masterBufferUnit,
    innerMaterial,
    overlapHeight,
    overlapWidth,
    overlapDepth,
    overlapUnit,
    onLog,
  } = options;

  const effectiveInnerBuffer =
    innerMaterial === "Poly Bag" ? 0 : innerBuffer;
  const innerBufferInches = convertBufferToInches(
    effectiveInnerBuffer,
    innerBufferUnit
  );
  const masterBufferInches = convertBufferToInches(
    masterBuffer,
    masterBufferUnit
  );
  const overlapHeightInches = convertBufferToInches(
    overlapHeight,
    overlapUnit
  );
  const overlapWidthInches = convertBufferToInches(
    overlapWidth,
    overlapUnit
  );
  const overlapDepthInches = convertBufferToInches(
    overlapDepth,
    overlapUnit
  );
  void overlapHeightInches;
  void overlapWidthInches;
  void overlapDepthInches;

  const getFieldDisplayName = (key: keyof FieldIds): string => {
    if ((FIELD_KEYS as Record<string, { name: string }>)[key as FieldKey]) {
      return FIELD_KEYS[key as FieldKey].name;
    }
    if (
      (OPTIONAL_FIELD_KEYS as Record<string, { name: string }>)[
        key as OptionalFieldKey
      ]
    ) {
      return OPTIONAL_FIELD_KEYS[key as OptionalFieldKey].name;
    }
    return key;
  };

  const canWriteField = (key: keyof FieldIds): boolean => {
    if (!fieldIds[key]) return false;
    const meta = fieldMetaMap?.[key];
    if (!meta || meta.type == null) return true;
    return meta.type === 2;
  };

  const selectedIds = normaliseIds(await view.getSelectedRecordIdList());
  let recordIds: string[];

  if (forceAll) {
    recordIds = normaliseIds(await view.getVisibleRecordIdList());
  } else if (selectedIds.length > 0) {
    recordIds = selectedIds;
  } else {
    recordIds = normaliseIds(await view.getVisibleRecordIdList());
  }

  if (!recordIds.length) {
    onLog("当前视图没有记录可以计算。");
    return;
  }

  onLog(`即将处理 ${recordIds.length} 条记录。`);

  let processed = 0;
  for (const [index, recordId] of recordIds.entries()) {
    let label = formatRecordLabel(recordId, index, null);
    try {
      const record = await table.getRecordById(recordId);
      const skippedWriteFields = new Set<string>();

      const trySetNumber = (
        updates: Promise<unknown>[],
        key: keyof FieldIds,
        value: number | null
      ): boolean => {
        const fieldId = fieldIds[key];
        if (!fieldId) return false;
        if (!canWriteField(key)) {
          const name = getFieldDisplayName(key);
          if (!skippedWriteFields.has(name)) {
            onLog(`${label} 字段 ${name} 为公式字段，已跳过写入。`);
            skippedWriteFields.add(name);
          }
          return false;
        }
        updates.push(table.setCellValue(fieldId, recordId, value));
        return true;
      };
      const fetchValue = (key: keyof FieldIds): number | null => {
        const fieldId = fieldIds[key];
        if (!fieldId) return null;
        const cellValue = record.fields[fieldId];
        return extractNumber(cellValue);
      };

      const fetchText = (key: keyof FieldIds): string | null => {
        const fieldId = fieldIds[key];
        if (!fieldId) return null;
        const cellValue = record.fields[fieldId];
        if (Array.isArray(cellValue) && cellValue.length) {
          const first = cellValue[0];
          if (typeof first === "object" && first) {
            const candidate =
              typeof (first as { text?: unknown }).text === "string"
                ? (first as { text?: unknown }).text
                : typeof (first as { text?: unknown }).text === "number" && Number.isFinite((first as { text?: unknown }).text)
                  ? String((first as { text?: unknown }).text)
                  : typeof (first as { value?: unknown }).value === "string"
                    ? (first as { value?: unknown }).value
                    : typeof (first as { value?: unknown }).value === "number" && Number.isFinite((first as { value?: unknown }).value)
                      ? String((first as { value?: unknown }).value)
                      : null;
            if (candidate != null) {
              return extractTextValue(candidate);
            }
          }
          if (typeof first === "string" || (typeof first === "number" && Number.isFinite(first))) {
            return extractTextValue(first);
          }
        }
        return extractTextValue(cellValue);
      };

      const clearInnerValues = async () => {
        const clears: Promise<unknown>[] = [];
        for (const key of INNER_FIELD_KEYS) {
          trySetNumber(clears, key, null);
        }
        if (clears.length) {
          await Promise.all(clears);
        }
      };

      const rawItemCode = fieldIds.itemCode ? fetchText("itemCode") : null;
      const itemCode =
        rawItemCode && rawItemCode.trim().length ? rawItemCode.trim() : null;
      label = formatRecordLabel(recordId, index, itemCode);

      const itemWidth = fetchValue("itemWidth");
      const itemDepth = fetchValue("itemDepth");
      const itemHeight = fetchValue("itemHeight");
      const itemWeight = fetchValue("itemWeight");
      const innerQtyRaw = fetchValue("innerQty");
      const masterQtyRaw = fetchValue("masterQty");

      if (
        !isPositive(itemWidth) ||
        !isPositive(itemDepth) ||
        !isPositive(itemHeight)
      ) {
        onLog(`${label} 未填写完整的产品尺寸，已跳过。`);
        processed += 1;
        continue;
      }

      if (innerQtyRaw != null && !Number.isInteger(innerQtyRaw)) {
        onLog(`${label} Inner Qty 需为整数，已跳过。`);
        processed += 1;
        continue;
      }

      if (masterQtyRaw != null && !Number.isInteger(masterQtyRaw)) {
        onLog(`${label} Master Qty 需为整数，已跳过。`);
        processed += 1;
        continue;
      }

      const innerQty = innerQtyRaw ?? 0;
      const masterQty = masterQtyRaw ?? 0;

      const existingInnerWidth = fetchValue("innerWidth");
      const existingInnerDepth = fetchValue("innerDepth");
      const existingInnerHeight = fetchValue("innerHeight");
      const existingInnerWeightLb = fetchValue("innerWeight");

      let innerArrangement: ArrangementResult | null = null;
      let masterArrangement: ArrangementResult | null = null;
      let netWeightKg: number | null = null;

      const innerUpdates: Promise<unknown>[] = [];

      if (innerQty > 0) {
        const arrangement = computeBestArrangement(
          innerQty,
          {
            width: itemWidth as number,
            depth: itemDepth as number,
            height: itemHeight as number,
          },
          innerBufferInches,
          {
            width: overlapWidthInches,
            depth: overlapDepthInches,
            height: overlapHeightInches,
          }
        );

        if (!arrangement) {
          onLog(`${label} 未找到适合的中盒排列方式。`);
        } else {
          innerArrangement = arrangement;
          trySetNumber(innerUpdates, "innerWidth", round(arrangement.width, 3));
          trySetNumber(innerUpdates, "innerDepth", round(arrangement.depth, 3));
          trySetNumber(innerUpdates, "innerHeight", round(arrangement.height, 3));
        }

        const computedInnerWeight = computeInnerGrossWeightLb(
          innerQty,
          itemWeight,
          innerMaterial
        );
        if (computedInnerWeight != null) {
          if (fieldIds.innerWeight) {
            const shouldUpdate =
              !isPositive(existingInnerWeightLb) ||
              Math.abs((existingInnerWeightLb ?? 0) - computedInnerWeight) >
                0.001;
            if (shouldUpdate) {
              if (
                trySetNumber(
                  innerUpdates,
                  "innerWeight",
                  round(computedInnerWeight, 3)
                )
              ) {
                onLog(
                  `${label} 自动补全中盒毛重：${computedInnerWeight.toFixed(
                    3
                  )} lbs。`
                );
              }
            }
          }
        } else if (!isPositive(existingInnerWeightLb)) {
          onLog(`${label} 缺少产品重量，无法推算中盒毛重。`);
        }
      } else {
        onLog(`${label} Inner Qty 为 0 或空，视为无中盒。`);
        await clearInnerValues();
      }

      if (innerUpdates.length) {
        await Promise.all(innerUpdates);
      }

      if (innerArrangement) {
        onLog(
          `${label} 中盒尺寸更新：${innerArrangement.width.toFixed(
            2
          )} × ${innerArrangement.depth.toFixed(
            2
          )} × ${innerArrangement.height.toFixed(2)} (in)。`
        );
      }

      if (masterQty <= 0) {
        onLog(`${label} Master Qty 为 0 或空，已跳过外箱计算。`);
        if (masterQty === 0) {
          try {
            await bitable.ui.showToast({
              toastType: ToastType.warning,
              message:
                "Case pack is zero, pls input the master qty as case pack!",
            });
          } catch (toastError) {
            logError("toast", toastError);
          }
        }
        processed += 1;
        continue;
      }

      const divisor = innerQty > 0 ? innerQty : 1;
      const ratio = masterQty / divisor;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        onLog(
          `${label} Master Qty (${masterQty}) 与 Inner Qty (${innerQty}) 的比例无效，已跳过。`
        );
        processed += 1;
        continue;
      }

      const masterUpdates: Promise<unknown>[] = [];

      if (innerQty > 0) {
        const innersPerMaster = ratio;
        if (!Number.isInteger(innersPerMaster)) {
          onLog(
            `${label} Master Qty (${masterQty}) 无法被 Inner Qty (${innerQty}) 整除，外箱计算已跳过。`
          );
          processed += 1;
          continue;
        }

        const baseWidth = [
          innerArrangement?.width,
          existingInnerWidth,
          itemWidth,
        ].find(isPositive);
        const baseDepth = [
          innerArrangement?.depth,
          existingInnerDepth,
          itemDepth,
        ].find(isPositive);
        const baseHeight = [
          innerArrangement?.height,
          existingInnerHeight,
          itemHeight,
        ].find(isPositive);

        if (!baseWidth || !baseDepth || !baseHeight) {
          onLog(`${label} 缺少可用的中盒尺寸，无法计算外箱。`);
          processed += 1;
          continue;
        }

        const arrangement = computeBestArrangement(
          innersPerMaster,
          {
            width: baseWidth,
            depth: baseDepth,
            height: baseHeight,
          },
          masterBufferInches
        );

        if (!arrangement) {
          onLog(`${label} 未找到适合的外箱排列方式。`);
          processed += 1;
          continue;
        }

        masterArrangement = arrangement;
        trySetNumber(masterUpdates, "masterWidth", round(arrangement.width, 3));
        trySetNumber(masterUpdates, "masterDepth", round(arrangement.depth, 3));
        trySetNumber(masterUpdates, "masterHeight", round(arrangement.height, 3));
      } else {
        const arrangement = computeBestArrangement(
          masterQty,
          {
            width: itemWidth as number,
            depth: itemDepth as number,
            height: itemHeight as number,
          },
          masterBufferInches,
          {
            width: overlapWidthInches,
            depth: overlapDepthInches,
            height: overlapHeightInches,
          }
        );

        if (!arrangement) {
          onLog(`${label} 未找到适合的外箱排列方式。`);
          processed += 1;
          continue;
        }

        masterArrangement = arrangement;
        trySetNumber(masterUpdates, "masterWidth", round(arrangement.width, 3));
        trySetNumber(masterUpdates, "masterDepth", round(arrangement.depth, 3));
        trySetNumber(masterUpdates, "masterHeight", round(arrangement.height, 3));
      }

      if (isPositive(itemWeight)) {
        netWeightKg = round(((itemWeight as number) / 1000) * masterQty, 3);
        trySetNumber(masterUpdates, "netWeight", netWeightKg);
      } else {
        trySetNumber(masterUpdates, "netWeight", null);
        onLog(`${label} 产品重量为空或为 0，净重已清空。`);
      }

      if (masterUpdates.length) {
        await Promise.all(masterUpdates);
      }

      if (masterArrangement) {
        onLog(
          `${label} 外箱尺寸更新：${masterArrangement.width.toFixed(
            2
          )} × ${masterArrangement.depth.toFixed(
            2
          )} × ${masterArrangement.height.toFixed(2)} (in)。`
        );
      }

      if (netWeightKg != null) {
        if (fieldIds.netWeight) {
          if (canWriteField("netWeight")) {
            onLog(`${label} 净重更新：${netWeightKg.toFixed(3)} kg。`);
          } else {
            onLog(
              `${label} 净重字段为公式，无法写入 ${netWeightKg.toFixed(3)} kg。`
            );
          }
        } else {
          onLog(
            `${label} 未配置净重字段，无法写入 ${netWeightKg.toFixed(3)} kg。`
          );
        }
      }

      processed += 1;
    } catch (err) {
      logError("record-calc", err);
      onLog(`${label} 计算失败：${(err as Error).message ?? "未知错误"}`);
    }
  }

  onLog(`已完成 ${processed}/${recordIds.length} 条记录计算。`);
}

export async function runCduCalculation(
  context: PluginContext,
  options: CduCalculationOptions
): Promise<void> {
  const {
    recordIds,
    widthCount,
    depthCount,
    heightCount,
    masterBuffer,
    masterBufferUnit,
    overlapWidth,
    overlapDepth,
    overlapHeight,
    overlapUnit,
    onLog,
  } = options;
  const { table, fieldIds, fieldMetaMap } = context;

  if (!recordIds.length) {
    onLog("未找到可计算的记录。");
    return;
  }

  const counts = {
    width: Math.floor(widthCount),
    depth: Math.floor(depthCount),
    height: Math.floor(heightCount),
  };

  if (counts.width <= 0 || counts.depth <= 0 || counts.height <= 0) {
    throw new Error("请输入 CDU 的宽/深/高个数。");
  }

  const overlapWidthInches = convertBufferToInches(overlapWidth, overlapUnit);
  const overlapDepthInches = convertBufferToInches(overlapDepth, overlapUnit);
  const overlapHeightInches = convertBufferToInches(overlapHeight, overlapUnit);
  const masterBufferInches = convertBufferToInches(
    masterBuffer,
    masterBufferUnit
  );
  const cduBufferInches = convertBufferToInches(CDU_BUFFER_CM, "cm");

  const getFieldDisplayName = (key: keyof FieldIds): string => {
    if ((FIELD_KEYS as Record<string, { name: string }>)[key as FieldKey]) {
      return FIELD_KEYS[key as FieldKey].name;
    }
    if (
      (OPTIONAL_FIELD_KEYS as Record<string, { name: string }>)[
        key as OptionalFieldKey
      ]
    ) {
      return OPTIONAL_FIELD_KEYS[key as OptionalFieldKey].name;
    }
    return key;
  };

  const canWriteField = (key: keyof FieldIds): boolean => {
    if (!fieldIds[key]) return false;
    const meta = fieldMetaMap?.[key];
    if (!meta || meta.type == null) return true;
    return meta.type === FieldType.Number;
  };

  for (const [index, recordId] of recordIds.entries()) {
    let label = formatRecordLabel(recordId, index, null);
    try {
      const record = await table.getRecordById(recordId);

      const fetchValue = (key: keyof FieldIds): number | null => {
        const fieldId = fieldIds[key];
        if (!fieldId) return null;
        const cellValue = record.fields[fieldId];
        return extractNumber(cellValue);
      };

      const fetchText = (key: keyof FieldIds): string | null => {
        const fieldId = fieldIds[key];
        if (!fieldId) return null;
        const cellValue = record.fields[fieldId];
        if (Array.isArray(cellValue) && cellValue.length) {
          const first = cellValue[0];
          if (typeof first === "object" && first) {
            const candidate =
              typeof (first as { text?: unknown }).text === "string"
                ? (first as { text?: unknown }).text
                : typeof (first as { value?: unknown }).value === "string"
                ? (first as { value?: unknown }).value
                : null;
            if (candidate != null) {
              return extractTextValue(candidate);
            }
          }
          if (
            typeof first === "string" ||
            (typeof first === "number" && Number.isFinite(first))
          ) {
            return extractTextValue(first);
          }
        }
        return extractTextValue(cellValue);
      };

      const rawItemCode = fieldIds.itemCode ? fetchText("itemCode") : null;
      label = formatRecordLabel(recordId, index, rawItemCode);

      const itemWidth = fetchValue("itemWidth");
      const itemDepth = fetchValue("itemDepth");
      const itemHeight = fetchValue("itemHeight");
      const masterQty = fetchValue("masterQty");

      if (
        !isPositive(itemWidth) ||
        !isPositive(itemDepth) ||
        !isPositive(itemHeight)
      ) {
        onLog(`${label} 未填写完整的产品尺寸，CDU 计算已跳过。`);
        continue;
      }

      if (!Number.isInteger(masterQty) || !masterQty) {
        onLog(`${label} Master Qty 无效，CDU 计算已跳过。`);
        continue;
      }

      const expected = counts.width * counts.depth * counts.height;
      if (expected !== masterQty) {
        onLog(
          `${label} CDU 个数 (${counts.width}×${counts.depth}×${counts.height}=${expected}) 与 Master Qty (${masterQty}) 不匹配，已跳过。`
        );
        continue;
      }

      const cduWidth =
        counts.width * (itemWidth as number) + cduBufferInches;
      const cduDepth =
        counts.depth * (itemDepth as number) + cduBufferInches;
      const cduHeight =
        counts.height * (itemHeight as number) + cduBufferInches;

      const outerWidth = cduWidth + overlapWidthInches + masterBufferInches;
      const outerDepth = cduDepth + overlapDepthInches + masterBufferInches;
      const outerHeight = cduHeight + overlapHeightInches + masterBufferInches;

      const updates: Promise<unknown>[] = [];
      const skippedFields = new Set<string>();

      const setValue = (
        key: keyof FieldIds,
        value: number | null
      ): boolean => {
        const fieldId = fieldIds[key];
        if (!fieldId) return false;
        if (!canWriteField(key)) {
          const name = getFieldDisplayName(key);
          if (!skippedFields.has(name)) {
            onLog(`${label} 字段 ${name} 为公式字段，已跳过写入。`);
            skippedFields.add(name);
          }
          return false;
        }
        updates.push(
          (async () => {
            try {
              await table.setCellValue(
                fieldId,
                recordId,
                value != null ? round(value, 3) : null
              );
            } catch (error) {
              const friendly = mapPermissionError(error);
              if (friendly) {
                throw friendly;
              }
              throw error;
            }
          })()
        );
        return true;
      };

      setValue("masterWidth", outerWidth);
      setValue("masterDepth", outerDepth);
      setValue("masterHeight", outerHeight);

      if (updates.length) {
        await Promise.all(updates);
      }

      onLog(
        `${label} CDU 尺寸：${round(cduWidth, 2).toFixed(2)} × ${round(
          cduDepth,
          2
        ).toFixed(2)} × ${round(cduHeight, 2).toFixed(2)} (in)。`
      );
      onLog(
        `${label} 外箱尺寸更新（CDU）：${round(outerWidth, 2).toFixed(
          2
        )} × ${round(outerDepth, 2).toFixed(2)} × ${round(
          outerHeight,
          2
        ).toFixed(2)} (in)。`
      );
    } catch (error) {
      logError("cdu-calc", error);
      onLog(`${label} CDU 计算失败：${(error as Error).message ?? "未知错误"}`);
    }
  }
}
