import { bitable, ToastType } from "@lark-base-open/js-sdk";
import type { PluginContext } from "./context";
import { computeBestArrangement } from "./arrangement";
import { convertBufferToInches, extractNumber, round } from "../utils/numbers";
import { logError } from "../utils/logger";

export type BufferUnit = "inch" | "cm";
export type InnerMaterial = "Box" | "Poly Bag";

const INNER_BOX_PACKAGING_WEIGHT_G = 100;
const GRAM_TO_POUND = 0.00220462;

export interface CalculationOptions {
  forceAll: boolean;
  innerBuffer: number;
  innerBufferUnit: BufferUnit;
  masterBuffer: number;
  masterBufferUnit: BufferUnit;
  innerMaterial: InnerMaterial;
  onLog: (message: string) => void;
}

function isPositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function computePackagingWeightLb(innerQty: number, itemWeight: number | null, innerMaterial: InnerMaterial): number | null {
  if (innerQty <= 0) return null;
  if (itemWeight == null || !Number.isFinite(itemWeight)) return null;
  const packagingWeight = innerMaterial === "Poly Bag" ? 0 : INNER_BOX_PACKAGING_WEIGHT_G;
  const totalGrams = innerQty * itemWeight + packagingWeight;
  return totalGrams * GRAM_TO_POUND;
}


function formatRecordLabel(recordId: string, index: number): string {
  return `#${index + 1} (${recordId})`;
}

function normaliseIds(list: (string | undefined)[]): string[] {
  return list.filter((id): id is string => Boolean(id));
}

export async function runCalculation(
  context: PluginContext,
  options: CalculationOptions
): Promise<void> {
  const { table, view, fieldIds } = context;
  const {
    forceAll,
    innerBuffer,
    innerBufferUnit,
    masterBuffer,
    masterBufferUnit,
    innerMaterial,
    onLog,
  } = options;

  const innerBufferInches = convertBufferToInches(innerBuffer, innerBufferUnit);
  const masterBufferInches = convertBufferToInches(masterBuffer, masterBufferUnit);

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
    const label = formatRecordLabel(recordId, index);
    try {
      const record = await table.getRecordById(recordId);
      const fetchValue = (key: keyof typeof fieldIds): number | null => {
        const fieldId = fieldIds[key];
        if (!fieldId) return null;
        const cellValue = record.fields[fieldId];
        return extractNumber(cellValue);
      };

      const itemWidth = fetchValue("itemWidth");
      const itemDepth = fetchValue("itemDepth");
      const itemHeight = fetchValue("itemHeight");
      const itemWeight = fetchValue("itemWeight");
      const innerQtyRaw = fetchValue("innerQty");
      const masterQtyRaw = fetchValue("masterQty");

      if (!isPositive(itemWidth) || !isPositive(itemDepth) || !isPositive(itemHeight)) {
        onLog(`${label} 未填写完整的产品尺寸，已跳过。`);
        processed += 1;
        continue;
      }

      const innerQty = innerQtyRaw ? Math.trunc(innerQtyRaw) : 0;
      const masterQty = masterQtyRaw ? Math.trunc(masterQtyRaw) : 0;

      const existingInnerWidth = fetchValue("innerWidth");
      const existingInnerDepth = fetchValue("innerDepth");
      const existingInnerHeight = fetchValue("innerHeight");
      const existingInnerWeightLb = fetchValue("innerWeight");

      let innerArrangement = null;
      let innerGrossWeightLb: number | null = null;

      if (innerQty > 0) {
        if ([itemWidth, itemDepth, itemHeight, itemWeight].some((value) => value == null)) {
          onLog(`${label} 缺少产品尺寸或重量，无法计算中盒。`);
        } else {
          const arrangement = computeBestArrangement(
            innerQty,
            {
              width: itemWidth as number,
              depth: itemDepth as number,
              height: itemHeight as number,
            },
            innerBufferInches
          );

          if (!arrangement) {
            onLog(`${label} 未找到适合的中盒排列方式。`);
          } else {
            innerArrangement = arrangement;
            innerGrossWeightLb = computePackagingWeightLb(
              innerQty,
              itemWeight as number,
              innerMaterial
            );

            const innerUpdates = [
              table.setCellValue(fieldIds.innerWidth, recordId, round(arrangement.width, 3)),
              table.setCellValue(fieldIds.innerDepth, recordId, round(arrangement.depth, 3)),
              table.setCellValue(fieldIds.innerHeight, recordId, round(arrangement.height, 3)),
            ];
            if (fieldIds.innerWeight && innerGrossWeightLb != null) {
              innerUpdates.push(
                table.setCellValue(fieldIds.innerWeight, recordId, round(innerGrossWeightLb, 3))
              );
            }
            await Promise.all(innerUpdates);

            onLog(
              `${label} 中盒尺寸更新：${arrangement.width.toFixed(2)} × ${arrangement.depth.toFixed(2)} × ${arrangement.height.toFixed(2)} (in)。`
            );
          }
        }
      } else {
        onLog(`${label} Inner Qty 为 0 或空，视为无中盒。`);
      }

      if (masterQty <= 0) {
        onLog(`${label} Master Qty 为 0 或空，已跳过外箱计算。`);
        if (masterQty === 0) {
          try {
            await bitable.ui.showToast({
              toastType: ToastType.warning,
              message: "Case pack is zero, pls input the master qty as case pack!",
            });
          } catch (toastError) {
            logError("toast", toastError);
          }
        }
        processed += 1;
        continue;
      }

      let masterArrangement = null;
      let netWeightKg: number | null = null;

      if (innerQty > 0) {
        const innersPerMaster = masterQty / innerQty;
        if (!Number.isInteger(innersPerMaster) || innersPerMaster <= 0) {
          onLog(`${label} Master Qty (${masterQty}) 无法被 Inner Qty (${innerQty}) 整除，外箱计算已跳过。`);
          processed += 1;
          continue;
        }

        const baseWidth = [innerArrangement?.width, existingInnerWidth, itemWidth].find(isPositive);
        const baseDepth = [innerArrangement?.depth, existingInnerDepth, itemDepth].find(isPositive);
        const baseHeight = [innerArrangement?.height, existingInnerHeight, itemHeight].find(isPositive);

        if (!baseWidth || !baseDepth || !baseHeight) {
          onLog(`${label} 缺少可用的中盒尺寸，无法计算外箱。`);
          processed += 1;
          continue;
        }

        masterArrangement = computeBestArrangement(
          innersPerMaster,
          {
            width: baseWidth,
            depth: baseDepth,
            height: baseHeight,
          },
          masterBufferInches
        );

        if (!masterArrangement) {
          onLog(`${label} 未找到适合的外箱排列方式。`);
          processed += 1;
          continue;
        }

        const innerWeightSourceLb =
          innerGrossWeightLb ?? existingInnerWeightLb ?? computePackagingWeightLb(innerQty, itemWeight, innerMaterial);

        if (innerWeightSourceLb != null) {
          netWeightKg = innerWeightSourceLb * innersPerMaster * 0.4536;
        } else if (itemWeight != null) {
          netWeightKg = (itemWeight / 1000) * masterQty;
        }
      } else {
        // 无中盒，仅使用单品尺寸
        if (!isPositive(itemWidth) || !isPositive(itemDepth) || !isPositive(itemHeight)) {
          onLog(`${label} 缺少产品尺寸，无法计算外箱。`);
          processed += 1;
          continue;
        }

        masterArrangement = computeBestArrangement(
          masterQty,
          {
            width: itemWidth,
            depth: itemDepth,
            height: itemHeight,
          },
          masterBufferInches
        );

        if (!masterArrangement) {
          onLog(`${label} 未找到适合的外箱排列方式。`);
          processed += 1;
          continue;
        }

        if (itemWeight != null) {
          netWeightKg = (itemWeight / 1000) * masterQty;
        }
      }

      if (!masterArrangement) {
        processed += 1;
        continue;
      }

      const updates = [
        table.setCellValue(fieldIds.masterWidth, recordId, round(masterArrangement.width, 3)),
        table.setCellValue(fieldIds.masterDepth, recordId, round(masterArrangement.depth, 3)),
        table.setCellValue(fieldIds.masterHeight, recordId, round(masterArrangement.height, 3)),
      ];

      if (fieldIds.netWeight && netWeightKg != null) {
        updates.push(table.setCellValue(fieldIds.netWeight, recordId, round(netWeightKg, 3)));
      }

      await Promise.all(updates);

      onLog(
        `${label} 外箱尺寸更新：${masterArrangement.width.toFixed(2)} × ${masterArrangement.depth.toFixed(2)} × ${masterArrangement.height.toFixed(2)} (in)。`
      );

      processed += 1;
    } catch (err) {
      logError("record-calc", err);
      onLog(`${label} 计算失败：${(err as Error).message ?? "未知错误"}`);
    }
  }

  onLog(`已完成 ${processed}/${recordIds.length} 条记录计算。`);
}
