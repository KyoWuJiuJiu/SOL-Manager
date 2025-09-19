import { bitable } from "@lark-base-open/js-sdk";
import { FIELD_KEYS, type FieldIds, type FieldKey } from "../config/fields";
import { getFieldIdByName, type FieldMetaLike } from "../utils/field";

export interface PluginContext {
  table: any;
  view: any;
  tableName: string;
  viewName: string;
  fieldIds: FieldIds;
}

export interface ContextLoadResult {
  context: PluginContext;
  missingFields: string[];
}

interface TableCandidate {
  table: any;
  view: any | null;
  tableName: string;
  viewName: string;
  fieldIds: FieldIds;
  missingFields: string[];
  recordCount: number;
}

function buildFieldMap(fieldMetas: FieldMetaLike[]): { fieldIds: FieldIds; missingFields: string[] } {
  const entries = Object.entries(FIELD_KEYS).map(([key, info]) => {
    const id = getFieldIdByName(fieldMetas, info.name, info.type);
    return [key, id ?? ""] as const;
  });

  const missingFields = entries
    .filter(([, id]) => !id)
    .map(([key]) => FIELD_KEYS[key as FieldKey].name);

  const fieldIds = entries.reduce<Record<string, string>>((acc, [key, id]) => {
    acc[key] = id ?? "";
    return acc;
  }, {}) as FieldIds;

  return { fieldIds, missingFields };
}

async function getRecordCount(table: any, view: any | null): Promise<number> {
  try {
    if (view && typeof view.getVisibleRecordIdList === "function") {
      const ids = await view.getVisibleRecordIdList();
      return Array.isArray(ids) ? ids.filter(Boolean).length : 0;
    }
    if (typeof table.getRecordIdList === "function") {
      const ids = await table.getRecordIdList();
      return Array.isArray(ids) ? ids.filter(Boolean).length : 0;
    }
    if (typeof table.getRecordCount === "function") {
      const count = await table.getRecordCount();
      return typeof count === "number" ? count : 0;
    }
  } catch (err) {
    console.warn("Failed to calculate record count", err);
  }
  return 0;
}

async function pickView(table: any): Promise<{ view: any | null; name: string; recordCount: number }> {
  const collect = async (view: any): Promise<{ view: any; name: string; recordCount: number }> => {
    const name = (await view?.getName?.()) ?? "";
    const recordCount = await getRecordCount(table, view);
    return { view, name, recordCount };
  };

  const tryMetaList = table?.getViewList ?? table?.getViewMetaList;
  if (typeof tryMetaList === "function") {
    try {
      const metas = await tryMetaList.call(table);
      if (Array.isArray(metas) && metas.length) {
        let best: { view: any; name: string; recordCount: number } | null = null;
        for (const meta of metas) {
          const view = await (table.getViewById?.(meta.id) ?? table.getView?.(meta.id));
          if (!view) continue;
          const current = await collect(view);
          if (!best || current.recordCount > best.recordCount) {
            best = current;
          }
        }
        if (best) return best;
      }
    } catch (err) {
      console.warn("Failed to iterate table views", err);
    }
  }

  const activeView = await table?.getActiveView?.();
  if (activeView) {
    return collect(activeView);
  }

  return { view: null, name: "", recordCount: await getRecordCount(table, null) };
}

async function buildCandidates(): Promise<TableCandidate[]> {
  const base = bitable.base;
  const candidates: TableCandidate[] = [];
  const getTableList = base?.getTableList;

  if (typeof getTableList !== "function") {
    return candidates;
  }

  let metas: any[] = [];
  try {
    metas = await getTableList.call(base);
  } catch (err) {
    console.warn("Failed to obtain table list", err);
    return candidates;
  }

  for (const meta of metas) {
    try {
      const table = await (base.getTableById?.(meta.id) ?? base.getTable?.(meta.id));
      if (!table) continue;
      const fieldMetas = await table.getFieldMetaList?.();
      if (!Array.isArray(fieldMetas)) continue;
      const { fieldIds, missingFields } = buildFieldMap(fieldMetas as FieldMetaLike[]);
      const { view, name: viewName, recordCount } = await pickView(table);
      const tableName = meta?.name ?? (await table.getName?.()) ?? "";
      candidates.push({
        table,
        view,
        tableName,
        viewName,
        fieldIds,
        missingFields,
        recordCount,
      });
    } catch (err) {
      console.warn("Failed to build table candidate", err);
    }
  }

  return candidates;
}

function selectBestCandidate(candidates: TableCandidate[]): TableCandidate | null {
  if (!candidates.length) return null;

  const sorted = [...candidates].sort((a, b) => {
    const missingDiff = a.missingFields.length - b.missingFields.length;
    if (missingDiff !== 0) return missingDiff;
    return b.recordCount - a.recordCount;
  });

  return sorted[0] ?? null;
}

async function loadFromActive(): Promise<ContextLoadResult> {
  const table = await bitable.base.getActiveTable();
  const view = await table.getActiveView();
  const [tableName, viewName, fieldMetas] = await Promise.all([
    table.getName(),
    view.getName(),
    table.getFieldMetaList(),
  ]);

  const { fieldIds, missingFields } = buildFieldMap(fieldMetas as FieldMetaLike[]);

  return {
    context: {
      table,
      view,
      tableName,
      viewName,
      fieldIds,
    },
    missingFields,
  };
}

export async function loadPluginContext(): Promise<ContextLoadResult> {
  const run = async (): Promise<ContextLoadResult> => {
    const candidates = await buildCandidates();
    const best = selectBestCandidate(candidates);

    if (best && best.view) {
      return {
        context: {
          table: best.table,
          view: best.view,
          tableName: best.tableName,
          viewName: best.viewName,
          fieldIds: best.fieldIds,
        },
        missingFields: best.missingFields,
      };
    }

    return loadFromActive();
  };

  const maybeOnReady = (bitable as unknown as {
    onReady?: (callback: () => Promise<void>) => Promise<void>;
  }).onReady;

  if (typeof maybeOnReady === "function") {
    let result: ContextLoadResult | null = null;
    await maybeOnReady(async () => {
      result = await run();
    });
    if (!result) {
      throw new Error("Failed to load plugin context");
    }
    return result;
  }

  return run();
}
