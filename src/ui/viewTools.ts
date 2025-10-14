import $ from "jquery";
import {
  bitable,
  ViewType,
  SetFilterType,
  FilterConjunction,
} from "@lark-base-open/js-sdk";
import { mapPermissionError } from "../utils/errors";
import { showError, showToast } from "../utils/logger";
import { findFieldMetaByName, type FieldMetaLike } from "../utils/field";

interface ViewButtonConfig {
  selector: string;
  viewName: string;
  fieldNames: string[];
  successMessage: string;
  pendingLabel?: string;
  customAction?: () => Promise<void>;
  includeSubstrings?: string[];
}

const PUBLIC_FIELD_NAMES: string[] = [
  "ITEM#",
  "Image",
  "Item Description",
  "Item Status",
  "Country of Origin",
  "Country Code",
  "Committed?",
  "Customer Name",
  "Initial Selection",
  "Brand",
  "Product Category",
  "NB PD",
  "Item Data Finalized?",
];

const VIEW_BUTTONS: ViewButtonConfig[] = [
  {
    selector: "#viewThreeStageButton",
    viewName: "价格",
    fieldNames: buildFieldNameList([
      "ITEM#",
      "Image",
      "Item Description",
      "RMB Purchase",
      "Dollar Purchase",
      "宁波毛利",
      "COGS ( Large QTY )",
      "COGS (Small QTY  )",
      "US Margin",
      "FOB Price",
      "Landing Cost",
      "Retail",
      "Retail AU",
      "Customer Margin",
      "Total Margin",
      "Freight Rate",
      "Loading Factor",
      "Rebate+Funding",
      "Total Duty",
      "CU FT",
    ]),
    successMessage: "已创建/更新“价格”视图",
    pendingLabel: "创建中…",
    includeSubstrings: ["TX"],
  },
  {
    selector: "#viewDimensionsButton",
    viewName: "尺寸",
    fieldNames: buildFieldNameList([
      "ITEM#",
      "Image",
      "Item Description",
      "Item Width (inch)",
      "Item Depth (inch)",
      "Item Height (inch)",
      "Item Weight ( g )",
      "Inner Qty",
      "Inner Width (inch)",
      "Inner Depth (inch)",
      "Inner Height (inch)",
      "Master Qty",
      "Master Width (inch)",
      "Master Depth (inch)",
      "Master Height (inch)",
      "Master Width (cm)",
      "Master Depth (cm)",
      "Master Height (cm)",
      "CBM",
      "CU FT",
      "N.W. (lbs)",
      "G. W (lbs)",
      "N.W. (kg)",
      "G.W. (kg)",
    ]),
    successMessage: "已创建/更新“尺寸”视图",
    pendingLabel: "创建中…",
  },
  {
    selector: "#viewTariffButton",
    viewName: "关税",
    fieldNames: buildFieldNameList([
      "ITEM#",
      "Image",
      "Item Description",
      "Country of Origin",
      "Country Code",
      "NB PD",
      "HTS Category",
      "HTS Code",
      "Duty %",
      "Tariff",
      "Increased Duty 2025",
      "Total Duty",
      "FOB Point",
      "Factory Name",
    ]),
    successMessage: "已创建/更新“关税”视图",
    pendingLabel: "创建中…",
  },
  {
    selector: "#viewSpecButton",
    viewName: "Spec",
    fieldNames: buildFieldNameList([
      "ITEM#",
      "Parent or Baby",
      "Parent #",
      "Ref Item # (LY Item #)",
      "Image",
      "Item Description",
      "Designer",
      "Country Code",
      "Committed?",
      "12 Digit UPC",
      "Initial Selection",
      "Packaging Type",
      "Cost Calculation Link",
      "Product Spec",
      "Material Breakdown",
      "WeVeel PD Comments",
      "Ningbo Comments",
      "Assortment Breakdown",
      "Count Per Package",
      "Item Packaging Spec",
      "MOQ",
    ]),
    successMessage: "已创建/更新“Spec”视图",
    pendingLabel: "创建中…",
  },
  {
    selector: "#viewSyncButton",
    viewName: "同步视图",
    fieldNames: [],
    successMessage: "已同步筛选和排序设置",
    pendingLabel: "同步中…",
    customAction: () => syncViewsFromReference(),
  },
];

export function initViewTools() {
  for (const config of VIEW_BUTTONS) {
    const $button = $(config.selector);
    if (!$button.length) continue;
    if ($button.data("view-tools-bound")) continue;
    $button.data("view-tools-bound", true);
    bindViewButton($button as JQuery<HTMLButtonElement>, config);
  }
}

function bindViewButton(
  $button: JQuery<HTMLButtonElement>,
  config: ViewButtonConfig
) {
  let busy = false;

  if (typeof $button.data("original-label") !== "string") {
    $button.data("original-label", $button.text());
  }

  $button.on("click", async () => {
    if (busy) return;

    try {
      busy = true;
      $button.prop("disabled", true);
      if (config.pendingLabel) {
        $button.text(config.pendingLabel);
      }

      if (config.customAction) {
        await config.customAction();
        showToast(config.successMessage, "success");
      } else {
        await createOrUpdateView(config);
        showToast(config.successMessage, "success");
      }
    } catch (error) {
      const message = (error as Error).message ?? "创建视图失败";
      showError(message);
    } finally {
      busy = false;
      $button.prop("disabled", false);
      const storedLabel = $button.data("original-label");
      if (typeof storedLabel === "string") {
        $button.text(storedLabel);
      }
    }
  });
}

function buildFieldNameList(specific: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of specific) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  for (const name of PUBLIC_FIELD_NAMES) {
    if (!name) continue;
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

async function createOrUpdateView(config: ViewButtonConfig) {
  try {
    const table = await bitable.base.getActiveTable();
    const viewMetas = await table.getViewMetaList?.();
    if (!Array.isArray(viewMetas)) {
      throw new Error("无法读取视图列表");
    }

    const fieldMetas = (await table.getFieldMetaList?.()) as FieldMetaLike[];
    if (!Array.isArray(fieldMetas)) {
      throw new Error("无法读取字段元数据");
    }

    const resolvedFieldIds: string[] = [];
    const missingFields: string[] = [];

    const fieldNames = [...config.fieldNames];

    if (Array.isArray(config.includeSubstrings) && config.includeSubstrings.length) {
      const seen = new Set(fieldNames.map((name) => name.trim()).filter(Boolean));
      for (const meta of fieldMetas) {
        const name = meta?.name;
        if (!name) continue;
        const trimmed = name.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        const match = config.includeSubstrings.some((sub) =>
          trimmed.includes(sub)
        );
        if (match) {
          seen.add(trimmed);
          fieldNames.push(trimmed);
        }
      }
    }

    resolveFieldIds(fieldNames, fieldMetas, resolvedFieldIds, missingFields);
    if (!resolvedFieldIds.length) {
      throw new Error("未找到任何匹配到的字段，无法配置视图");
    }

    const existing = viewMetas.find(
      (meta: any) => (meta?.name ?? "").trim() === config.viewName
    );

    let viewId: string | undefined;
    if (existing?.id) {
      viewId = existing.id;
    } else {
      const { viewId: newId } = await table.addView({
        type: ViewType.Grid,
        name: config.viewName,
      });
      viewId = newId;
    }

    const view =
      (await table.getViewById?.(viewId)) ?? (await table.getView?.(viewId));
    if (!view) {
      throw new Error("无法获取视图对象");
    }

    const allFieldIds = fieldMetas
      .map((meta) => meta.id)
      .filter((id): id is string => Boolean(id));
    const desiredSet = new Set(resolvedFieldIds);
    const hiddenIds = allFieldIds.filter((id) => !desiredSet.has(id));
    if (hiddenIds.length) {
      await view.hideField(hiddenIds);
    }
    await view.showField(resolvedFieldIds);
    await view.applySetting?.();

    if (missingFields.length) {
      showToast(
        `视图“${config.viewName}”已更新，但以下字段未找到：${missingFields.join(", ")}`,
        "warning"
      );
    }
  } catch (error) {
    const friendly = mapPermissionError(error);
    if (friendly) {
      throw friendly;
    }
    throw error;
  }
}

function resolveFieldIds(
  fieldNames: string[],
  fieldMetas: FieldMetaLike[],
  resolved: string[],
  missing: string[]
): FieldMetaLike[] {
  const metas: FieldMetaLike[] = [];
  for (const name of fieldNames) {
    const meta = findFieldMetaByName(fieldMetas, name);
    if (meta?.id) {
      resolved.push(meta.id);
      metas.push(meta);
    } else {
      missing.push(name);
    }
  }
  return metas;
}

const REFERENCE_VIEW_NAME = "价格";
const TARGET_VIEW_NAMES = ["价格", "尺寸", "关税", "Spec"];

async function syncViewsFromReference() {
  try {
    const table = await bitable.base.getActiveTable();
    const viewMetas = await table.getViewMetaList?.();
    if (!Array.isArray(viewMetas)) {
      throw new Error("无法读取视图列表");
    }

    const lookup = new Map<string, { id: string; name: string }>();
    for (const meta of viewMetas) {
      const name = (meta?.name ?? "").trim();
      const id = meta?.id;
      if (!name || !id) continue;
      lookup.set(name, { id, name });
    }

    const reference = lookup.get(REFERENCE_VIEW_NAME);
    if (!reference) {
      throw new Error(`未找到名为“${REFERENCE_VIEW_NAME}”的视图，请先创建该视图`);
    }

    const referenceView =
      (await table.getViewById?.(reference.id)) ??
      (await table.getView?.(reference.id));
    if (!referenceView) {
      throw new Error("无法获取参考视图对象");
    }

    const [filterInfo, sortInfo, groupInfo] = await Promise.all([
      referenceView.getFilterInfo?.() ?? null,
      referenceView.getSortInfo?.() ?? null,
      referenceView.getGroupInfo?.() ?? null,
    ]);

    const targetNames = TARGET_VIEW_NAMES.filter((name) => lookup.has(name));
    if (!targetNames.length) {
      throw new Error("未找到任何可同步的目标视图");
    }

    for (const name of targetNames) {
      const meta = lookup.get(name);
      if (!meta) continue;
      const view =
        (await table.getViewById?.(meta.id)) ?? (await table.getView?.(meta.id));
      if (!view) continue;

      await syncFilter(view, filterInfo);
      if (typeof view.setSortInfo === "function") {
        await view.setSortInfo(Array.isArray(sortInfo) ? sortInfo : []);
      }
      if (typeof view.setGroupInfo === "function") {
        await view.setGroupInfo(Array.isArray(groupInfo) ? groupInfo : []);
      }
      await view.applySetting?.();
    }
  } catch (error) {
    const friendly = mapPermissionError(error);
    if (friendly) {
      throw friendly;
    }
    throw error;
  }
}

async function syncFilter(view: any, filterInfo: any) {
  if (!view?.getFilterInfo || !view?.setFilter) return;

  const existing = await view.getFilterInfo();
  if (existing?.conditions?.length) {
    for (const condition of existing.conditions) {
      const conditionId = (condition as { conditionId?: string }).conditionId;
      if (!conditionId) continue;
      try {
        await view.setFilter(SetFilterType.DeleteCondition, conditionId);
      } catch (error) {
        const friendly = mapPermissionError(error);
        if (friendly) {
          throw friendly;
        }
        throw error;
      }
    }
  }

  if (!filterInfo?.conditions?.length) {
    if (filterInfo?.conjunction && view.setFilterConjunction) {
        try {
          await view.setFilterConjunction(filterInfo.conjunction);
        } catch (error) {
          const friendly = mapPermissionError(error);
          if (friendly) {
            throw friendly;
          }
          throw error;
        }
    }
    return;
  }

  const conditions = filterInfo.conditions as Array<Record<string, unknown>>;
  for (const condition of conditions) {
    const { conditionId: _omit, ...rest } = condition;
    try {
      await view.setFilter(SetFilterType.AddCondition, rest);
    } catch (error) {
      const friendly = mapPermissionError(error);
      if (friendly) {
        throw friendly;
      }
      throw error;
    }
  }

  const conjunction = filterInfo.conjunction ?? FilterConjunction.And;
  if (view.setFilterConjunction) {
    try {
      await view.setFilterConjunction(conjunction);
    } catch (error) {
      const friendly = mapPermissionError(error);
      if (friendly) {
        throw friendly;
      }
      throw error;
    }
  }
}
