import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";

export type FormulaResolution = "keep" | "replace" | "cancel";

export interface FormulaConflictContext {
  fieldId: string;
  fieldName: string;
  targetLabel: string;
  conversionType: "text" | "number";
  formatter?: NumberFormatter;
}

export interface ConversionHandlers {
  resolveFormulaConflict?: (
    context: FormulaConflictContext
  ) => Promise<FormulaResolution | void>;
}

export interface ConversionSummary {
  applied: number;
  keptFormula: number;
  skipped: number;
}

export async function convertFieldsToText(
  fieldIds: string[],
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldIds.length) return summary;

  const table = await bitable.base.getActiveTable();
  for (const fieldId of fieldIds) {
    if (!fieldId) {
      summary.skipped += 1;
      continue;
    }

    const meta = await safeGetFieldMeta(table, fieldId);
    if (meta?.type === FieldType.Formula) {
      const resolution = await resolveFormula(meta, handlers, {
        fieldId,
        fieldName: meta.name ?? "",
        targetLabel: "文本",
        conversionType: "text",
      });

      if (resolution === "cancel") {
        summary.skipped += 1;
        continue;
      }

      if (resolution === "keep") {
        summary.keptFormula += 1;
        summary.skipped += 1;
        continue;
      }
    }

    await table.setField(fieldId, { type: FieldType.Text });
    summary.applied += 1;
  }

  return summary;
}

export async function getSelectedFieldIds(): Promise<string[]> {
  try {
    const selection = await bitable.base.getSelection();
    const fieldId = selection?.fieldId;
    return fieldId ? [fieldId] : [];
  } catch (error) {
    console.warn("获取字段选区失败", error);
    return [];
  }
}

export async function convertFieldsToInteger(
  fieldIds: string[],
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  return convertFieldsToNumber(
    fieldIds,
    NumberFormatter.INTEGER,
    "数字（整数）",
    handlers
  );
}

export async function convertFieldsToDecimal2(
  fieldIds: string[],
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  return convertFieldsToNumber(
    fieldIds,
    NumberFormatter.DIGITAL_ROUNDED_2,
    "数字（保留两位小数）",
    handlers
  );
}

async function convertFieldsToNumber(
  fieldIds: string[],
  formatter: NumberFormatter,
  targetLabel: string,
  handlers: ConversionHandlers
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldIds.length) return summary;

  const table = await bitable.base.getActiveTable();

  for (const fieldId of fieldIds) {
    if (!fieldId) {
      summary.skipped += 1;
      continue;
    }

    const meta = await safeGetFieldMeta(table, fieldId);

    if (meta?.type === FieldType.Formula) {
      const resolution = await resolveFormula(meta, handlers, {
        fieldId,
        fieldName: meta.name ?? "",
        targetLabel,
        conversionType: "number",
        formatter,
      });

      if (resolution === "cancel") {
        summary.skipped += 1;
        continue;
      }

      if (resolution === "keep") {
        await applyFormatterToFormula(table, fieldId, meta, formatter);
        summary.applied += 1;
        summary.keptFormula += 1;
        continue;
      }
    }

    await table.setField(fieldId, {
      type: FieldType.Number,
      property: { formatter },
    });
    summary.applied += 1;
  }

  return summary;
}

async function safeGetFieldMeta(table: any, fieldId: string) {
  try {
    return await table.getFieldMetaById(fieldId);
  } catch (error) {
    console.warn("读取字段元数据失败", fieldId, error);
    return null;
  }
}

async function applyFormatterToFormula(
  table: any,
  fieldId: string,
  meta: any,
  formatter: NumberFormatter
) {
  const property = cloneFormulaProperty(meta?.property);
  property.formatter = formatter;

  if (property.dataType) {
    property.dataType = {
      ...property.dataType,
      property: {
        ...(property.dataType?.property ?? {}),
        formatter,
      },
      type: FieldType.Number,
    };
  } else {
    property.dataType = {
      type: FieldType.Number,
      property: { formatter },
    };
  }

  await table.setField(fieldId, {
    type: FieldType.Formula,
    property,
  });
}

function cloneFormulaProperty(property: any) {
  if (!property) return {};
  try {
    return JSON.parse(JSON.stringify(property));
  } catch (error) {
    console.warn("无法克隆公式字段属性", error);
    return { ...property };
  }
}

async function resolveFormula(
  meta: any,
  handlers: ConversionHandlers,
  context: FormulaConflictContext
): Promise<FormulaResolution> {
  const resolver = handlers.resolveFormulaConflict;
  if (!resolver) {
    return "cancel";
  }

  const decision = await resolver(context);
  if (decision === "keep" || decision === "replace") {
    return decision;
  }
  return "cancel";
}

function createEmptySummary(): ConversionSummary {
  return { applied: 0, keptFormula: 0, skipped: 0 };
}
