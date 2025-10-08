import {
  bitable,
  CurrencyCode,
  DateFormatter,
  FieldType,
  NumberFormatter,
  SelectOptionsType,
} from "@lark-base-open/js-sdk";

const FORMULA_OUTPUT_TEXT = 201;
const FORMULA_OUTPUT_NUMBER = 202;

export type FormulaResolution = "keep" | "replace" | "cancel";

export interface FormulaConflictContext {
  fieldId: string;
  fieldName: string;
  targetLabel: string;
  conversionType:
    | "text"
    | "number"
    | "currency"
    | "single-select"
    | "user"
    | "formula"
    | "date";
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
  fieldId: string | null,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldId) return summary;

  const table = await bitable.base.getActiveTable();
  const meta = await safeGetFieldMeta(table, fieldId);
  if (meta?.type === FieldType.Formula) {
    const resolution = await resolveFormula(handlers, {
      fieldId,
      fieldName: meta.name ?? "",
      targetLabel: "文本",
      conversionType: "text",
    });

    if (resolution === "cancel") {
      return summary;
    }

    if (resolution === "keep") {
      await applyTextOutputToFormula(table, fieldId, meta);
      summary.applied += 1;
      summary.keptFormula += 1;
      return summary;
    }
  }

  await table.setField(fieldId, { type: FieldType.Text });
  summary.applied += 1;

  return summary;
}

export async function getSelectedFieldId(): Promise<string | null> {
  try {
    const selection = await bitable.base.getSelection();
    const fieldId = selection?.fieldId; //已经验证过了, 确实是fieldId, @2025/10/4 在民宿里验证的
    return fieldId ?? null;
  } catch (error) {
    console.warn("获取字段选取失败", error);
    return null;
  }
}

export async function convertFieldsToInteger(
  fieldId: string | null,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  return convertFieldToNumber(
    fieldId,
    NumberFormatter.INTEGER,
    "数字（整数）",
    handlers
  );
}

export async function convertFieldsToDecimal2(
  fieldId: string | null,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  return convertFieldToNumber(
    fieldId,
    NumberFormatter.DIGITAL_ROUNDED_2,
    "数字（保留两位小数）",
    handlers
  );
}

export interface CurrencyConversionOptions {
  currencyCode: CurrencyCode;
  decimalDigits: number;
}

export async function convertFieldToCurrency(
  fieldId: string | null,
  options: CurrencyConversionOptions,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  const property = buildCurrencyFieldProperty(options);
  return convertFieldWithConfig(fieldId, handlers, {
    targetType: FieldType.Currency,
    targetLabel: "货币",
    conversionType: "currency",
    property,
    applyFormulaOutput: (table, id, meta) =>
      applyCurrencyOutputToFormula(table, id, meta, options),
  });
}

export async function convertFieldToSingleSelect(
  fieldId: string | null,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldId) return summary;

  const table = await bitable.base.getActiveTable();
  const meta = await safeGetFieldMeta(table, fieldId);

  const snapshot = await snapshotFieldValues(table, fieldId);

  if (meta?.type === FieldType.Formula) {
    // 公式字段直接转换单选，无保留选项
  }

  let field: any = null;

  if (meta?.type !== FieldType.SingleSelect) {
    const optionPayload = snapshot.uniqueValues.length
      ? createSelectOptionPayload(snapshot.uniqueValues)
      : undefined;

    try {
      await table.setField(fieldId, {
        type: FieldType.SingleSelect,
        ...(optionPayload
          ? {
              property: {
                options: optionPayload,
                optionsType: SelectOptionsType.STATIC,
              },
            }
          : {}),
      });
      summary.applied += 1;
      await delay(50);
    } catch (error) {
      console.warn("切换字段为单选类型失败", error);
      summary.skipped += 1;
      return summary;
    }
  } else {
    summary.applied += 1;
  }

  try {
    field = await table.getField(fieldId);
  } catch (error) {
    console.warn("获取单选字段失败", error);
  }

  if (!field || typeof field.getOptions !== "function") {
    return summary;
  }

  let existingOptions: Array<{ id: string; name: string }> = [];
  try {
    existingOptions = (await field.getOptions()) ?? [];
  } catch (error) {
    console.warn("读取单选字段选项失败", error);
  }

  const existingNames = new Set(
    existingOptions.map((option) => option.name.trim()).filter(Boolean)
  );

  const newOptions = snapshot.uniqueValues
    .filter((value) => !existingNames.has(value))
    .map((value) => ({ name: value }));

  if (newOptions.length && typeof field.addOptions === "function") {
    try {
      await field.addOptions(newOptions);
      await delay(20);
      existingOptions = (await field.getOptions()) ?? existingOptions;
    } catch (error) {
      console.warn("新增单选选项失败", error);
    }
  }

  if (!existingOptions.length) {
    return summary;
  }

  const optionMap = new Map(
    existingOptions.map((option) => [option.name, option.id])
  );

  await processInBatches(snapshot.records, 20, async (record) => {
    if (!record.value) return;
    const optionId = optionMap.get(record.value);
    if (!optionId) return;
    await setSingleSelectValue(
      field,
      table,
      fieldId,
      record.recordId,
      optionId,
      record.value
    );
  });

  return summary;
}

export interface UserFieldConversionOptions {
  multiple: boolean;
}

export async function convertFieldToUser(
  fieldId: string | null,
  options: UserFieldConversionOptions | undefined,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  return convertFieldWithConfig(fieldId, handlers, {
    targetType: FieldType.User,
    targetLabel: "人员",
    conversionType: "user",
    property: {
      multiple: options?.multiple ?? false,
    },
  });
}

export const FORMULA_ALREADY_TYPE_MESSAGE = "选择的字段已经是公式类型";

export async function convertFieldToFormula(
  fieldId: string | null,
  options: { formula: string },
  _handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldId) return summary;

  const table = await bitable.base.getActiveTable();
  const meta = await safeGetFieldMeta(table, fieldId);

  if (meta?.type === FieldType.Formula) {
    throw new Error(FORMULA_ALREADY_TYPE_MESSAGE);
  }

  try {
    await table.setField(fieldId, {
      type: FieldType.Formula,
      property: { formula: options.formula },
    });
    summary.applied += 1;
  } catch (error) {
    console.warn("设置字段为公式失败", error);
    summary.skipped += 1;
    throw error;
  }

  return summary;
}

export interface DateFieldConversionOptions {
  dateFormat: DateFormatter;
  displayTimeZone?: boolean;
  autoFill?: boolean;
}

export async function convertFieldToDate(
  fieldId: string | null,
  options: DateFieldConversionOptions,
  handlers: ConversionHandlers = {}
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldId) return summary;

  const property = {
    dateFormat: options.dateFormat,
    displayTimeZone: options.displayTimeZone ?? false,
    autoFill: options.autoFill ?? false,
  } as const;

  const table = await bitable.base.getActiveTable();
  const meta = await safeGetFieldMeta(table, fieldId);

  if (meta?.type === FieldType.Formula) {
    try {
      await table.setField(fieldId, {
        type: FieldType.DateTime,
        property,
      });
      summary.applied += 1;
    } catch (error) {
      console.warn("设置字段为日期失败", error);
      summary.skipped += 1;
    }
    return summary;
  }

  return convertFieldWithConfig(fieldId, handlers, {
    targetType: FieldType.DateTime,
    targetLabel: "日期",
    conversionType: "date",
    property,
  });
}

async function convertFieldToNumber(
  fieldId: string | null,
  formatter: NumberFormatter,
  targetLabel: string,
  handlers: ConversionHandlers
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldId) return summary;

  const table = await bitable.base.getActiveTable();
  const meta = await safeGetFieldMeta(table, fieldId);

  if (meta?.type === FieldType.Formula) {
    const resolution = await resolveFormula(handlers, {
      fieldId,
      fieldName: meta.name ?? "",
      targetLabel,
      conversionType: "number",
      formatter,
    });

    if (resolution === "cancel") {
      return summary;
    }

    if (resolution === "keep") {
      await applyFormatterToFormula(table, fieldId, meta, formatter);
      summary.applied += 1;
      summary.keptFormula += 1;
      return summary;
    }
  }

  if (meta?.type !== FieldType.Number) {
    try {
      await table.setField(fieldId, { type: FieldType.Number });
    } catch (error) {
      console.warn("切换字段为数字类型失败", fieldId, error);
      summary.skipped += 1;
      return summary;
    }
  }

  await setNumberFormatter(table, fieldId, formatter);
  summary.applied += 1;

  return summary;
}

interface ConvertConfig {
  targetType: FieldType;
  targetLabel: string;
  conversionType: FormulaConflictContext["conversionType"];
  property?: Record<string, unknown>;
  afterConvert?: (table: any, fieldId: string) => Promise<void>;
  applyFormulaOutput?: (
    table: any,
    fieldId: string,
    meta: any
  ) => Promise<void>;
}

async function convertFieldWithConfig(
  fieldId: string | null,
  handlers: ConversionHandlers,
  config: ConvertConfig
): Promise<ConversionSummary> {
  const summary = createEmptySummary();
  if (!fieldId) return summary;

  const table = await bitable.base.getActiveTable();
  const meta = await safeGetFieldMeta(table, fieldId);

  if (meta?.type === FieldType.Formula) {
    const resolution = await resolveFormula(handlers, {
      fieldId,
      fieldName: meta.name ?? "",
      targetLabel: config.targetLabel,
      conversionType: config.conversionType,
    });

    if (resolution === "cancel") {
      return summary;
    }
    if (resolution === "keep") {
      if (config.applyFormulaOutput) {
        try {
          await config.applyFormulaOutput(table, fieldId, meta);
          summary.applied += 1;
          summary.keptFormula += 1;
        } catch (error) {
          console.warn("更新公式字段输出失败", error);
          summary.skipped += 1;
        }
      } else {
        summary.keptFormula += 1;
        summary.skipped += 1;
      }
      return summary;
    }
  }

  try {
    const payload: Record<string, unknown> = { type: config.targetType };
    if (config.property) {
      payload.property = config.property;
    }
    await table.setField(fieldId, payload);
    summary.applied += 1;
  } catch (error) {
    console.warn("设置字段类型失败", error);
    summary.skipped += 1;
    return summary;
  }

  if (config.afterConvert) {
    try {
      await config.afterConvert(table, fieldId);
    } catch (error) {
      console.warn("后续字段更新失败", error);
    }
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
      type: FORMULA_OUTPUT_NUMBER,
      UIType: "Number",
    };
  } else {
    property.dataType = {
      type: FORMULA_OUTPUT_NUMBER,
      property: { formatter },
      UIType: "Number",
    };
  }

  await table.setField(fieldId, {
    type: FieldType.Formula,
    property,
  });
}

async function applyTextOutputToFormula(
  table: any,
  fieldId: string,
  meta: any
) {
  const property = cloneFormulaProperty(meta?.property);

  delete property.formatter;
  delete property.currencyCode;

  property.dataType = {
    type: FORMULA_OUTPUT_TEXT,
    property: {},
    UIType: "Text",
  };

  await table.setField(fieldId, {
    type: FieldType.Formula,
    property,
  });
}

async function applyCurrencyOutputToFormula(
  table: any,
  fieldId: string,
  meta: any,
  options: CurrencyConversionOptions
) {
  const property = cloneFormulaProperty(meta?.property);

  const formatter = buildCurrencyFormatter(
    options.currencyCode,
    options.decimalDigits
  );

  property.currencyCode = options.currencyCode;
  property.formatter = formatter;

  property.dataType = {
    type: FORMULA_OUTPUT_NUMBER,
    property: {
      currencyCode: options.currencyCode,
      formatter,
    },
    UIType: "Currency",
  };

  await table.setField(fieldId, {
    type: FieldType.Formula,
    property,
  });
}

function buildCurrencyFormatter(code: CurrencyCode, digits: number): string {
  const symbol =
    code === CurrencyCode.USD ? "$" : code === CurrencyCode.CNY ? "¥" : "";
  const fractional = digits > 0 ? `.${"0".repeat(digits)}` : "";
  return `${symbol}#,##0${fractional}`;
}

function buildCurrencyFieldProperty(options: CurrencyConversionOptions) {
  const formatter = buildCurrencyFormatter(
    options.currencyCode,
    options.decimalDigits
  );
  return {
    currencyCode: options.currencyCode,
    decimalDigits: options.decimalDigits,
    formatter,
  };
}

async function setNumberFormatter(
  table: any,
  fieldId: string,
  formatter: NumberFormatter
) {
  try {
    const field = await table.getFieldById(fieldId);
    if (field && typeof field.setFormatter === "function") {
      await field.setFormatter(formatter);
      return;
    }
  } catch (error) {
    console.warn("调用 setFormatter 失败，将回退为直接设置字段属性", error);
  }

  await table.setField(fieldId, {
    type: FieldType.Number,
    property: { formatter },
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

interface SnapshotRecord {
  recordId: string;
  value: string | null;
}

interface FieldSnapshot {
  records: SnapshotRecord[];
  uniqueValues: string[];
}

async function snapshotFieldValues(
  table: any,
  fieldId: string
): Promise<FieldSnapshot> {
  const recordIds = await safeGetRecordIds(table);
  const records: SnapshotRecord[] = [];
  const unique = new Set<string>();

  await processInBatches(recordIds, 20, async (recordId) => {
    let rawValue: unknown = null;
    try {
      rawValue = await safeGetCellValue(table, fieldId, recordId);
    } catch (error) {
      console.warn("读取单元格失败", { fieldId, recordId, error });
    }
    const text = extractCellText(rawValue);
    if (text) {
      records.push({ recordId, value: text });
      unique.add(text);
    } else {
      records.push({ recordId, value: null });
    }
  });

  return { records, uniqueValues: Array.from(unique) };
}

function extractCellText(cellValue: unknown): string | null {
  if (cellValue == null) return null;
  if (typeof cellValue === "string") {
    const trimmed = cellValue.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof cellValue === "number" && Number.isFinite(cellValue)) {
    return String(cellValue);
  }
  if (Array.isArray(cellValue)) {
    for (const item of cellValue) {
      const text = extractCellText(item);
      if (text) return text;
    }
    return null;
  }
  if (typeof cellValue === "object") {
    const candidate = cellValue as { text?: unknown; value?: unknown };
    const textCandidate = candidate.text ?? candidate.value;
    if (typeof textCandidate === "string") {
      const trimmed = textCandidate.trim();
      return trimmed.length ? trimmed : null;
    }
    if (typeof textCandidate === "number" && Number.isFinite(textCandidate)) {
      return String(textCandidate);
    }
  }
  return null;
}

async function safeGetRecordIds(table: any): Promise<string[]> {
  try {
    if (typeof table.getRecordIdList === "function") {
      const ids = await table.getRecordIdList();
      if (Array.isArray(ids)) {
        const list = ids.filter((id) => typeof id === "string" && id.length);
        if (list.length) return list;
      }
    }

    if (typeof table.getRecordList === "function") {
      const records = await table.getRecordList();
      if (Array.isArray(records)) {
        const list = records
          .map((item) =>
            typeof item === "object" && item
              ? (item as { id?: unknown }).id
              : null
          )
          .filter((id): id is string => typeof id === "string" && id.length);
        if (list.length) return list;
      }
    }

    if (typeof table.getActiveView === "function") {
      const view = await table.getActiveView();
      const viewList = await view?.getVisibleRecordIdList?.();
      if (Array.isArray(viewList)) {
        const list = viewList.filter(
          (id) => typeof id === "string" && id.length
        );
        if (list.length) return list;
      }
    }
  } catch (error) {
    console.warn("获取记录 ID 列表失败", error);
  }
  return [];
}

async function safeGetCellValue(table: any, fieldId: string, recordId: string) {
  if (typeof table.getCellValue === "function") {
    return table.getCellValue(fieldId, recordId);
  }
  if (typeof table.getRecordById === "function") {
    const record = await table.getRecordById(recordId);
    return record?.fields?.[fieldId];
  }
  return null;
}

async function setSingleSelectValue(
  field: any,
  table: any,
  fieldId: string,
  recordId: string,
  optionId: string,
  optionName: string
) {
  try {
    if (typeof field.setValue === "function") {
      await field.setValue(recordId, optionId);
      return;
    }
  } catch (error) {
    console.warn("直接设置单选字段值失败，将尝试回退", error);
  }

  try {
    await table.setCellValue(fieldId, recordId, {
      id: optionId,
      text: optionName,
    });
  } catch (error) {
    console.warn("回退设置单选字段值失败", error);
  }
}

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  handler: (item: T) => Promise<void>
) {
  if (!items.length) return;
  const size = Math.max(1, batchSize);
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const results = await Promise.allSettled(
      slice.map((item) => handler(item))
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("批量处理失败", result.reason);
      }
    }
  }
}

function createSelectOptionPayload(values: string[]) {
  const colors = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  ];
  return values.map((name, index) => ({
    name,
    color: colors[index % colors.length],
  }));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
