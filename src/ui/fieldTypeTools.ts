import $ from "jquery";
import { CurrencyCode, DateFormatter } from "@lark-base-open/js-sdk";
import {
  convertFieldToCurrency,
  convertFieldToDate,
  convertFieldToFormula,
  convertFieldToAttachment,
  convertFieldToSingleSelect,
  convertFieldToUser,
  convertFieldsToDecimal2,
  convertFieldsToInteger,
  convertFieldsToText,
  getSelectedFieldId,
  FORMULA_ALREADY_TYPE_MESSAGE,
  type ConversionHandlers,
  type ConversionSummary,
  type CurrencyConversionOptions,
} from "../fieldType";
import { showError, showToast } from "../utils/logger";
import { showConfirmDialog } from "./dialogue";

interface ButtonBinding {
  selector: string;
  actionLabel: string;
  action: (
    fieldId: string | null,
    handlers: ConversionHandlers,
    options?: unknown
  ) => Promise<ConversionSummary>;
  successMessage: string;
  pendingLabel?: string;
  prepare?: () => Promise<unknown>;
}

const BUTTON_BINDINGS: ButtonBinding[] = [
  {
    selector: "#fieldTypeCurrencyButton",
    actionLabel: "货币",
    prepare: promptCurrencyOptions,
    action: async (fieldId, handlers, payload) =>
      convertFieldToCurrency(
        fieldId,
        payload as CurrencyConversionOptions,
        handlers
      ),
    successMessage: "字段已设置为货币",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeSingleSelectButton",
    actionLabel: "单选",
    action: async (fieldId, handlers) =>
      convertFieldToSingleSelect(fieldId, handlers),
    successMessage: "字段已设置为单选",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeUserButton",
    actionLabel: "人员",
    action: async (fieldId, handlers) => convertFieldToUser(fieldId, undefined, handlers),
    successMessage: "字段已设置为人员",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeFormulaButton",
    actionLabel: "公式",
    action: async (fieldId, handlers) =>
      convertFieldToFormula(fieldId, { formula: "" }, handlers),
    successMessage: "字段已设置为公式",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeDateButton",
    actionLabel: "日期",
    action: async (fieldId, handlers) =>
      convertFieldToDate(
        fieldId,
        {
          dateFormat: DateFormatter.DATE_YMD_WITH_HYPHEN,
          displayTimeZone: false,
          autoFill: false,
        },
        handlers
      ),
    successMessage: "字段已设置为日期",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeAttachmentButton",
    actionLabel: "附件",
    action: async (fieldId) => convertFieldToAttachment(fieldId),
    successMessage: "字段已设置为附件",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeTextButton",
    actionLabel: "文本",
    action: convertFieldsToText,
    successMessage: "字段已设置为文本",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeIntegerButton",
    actionLabel: "数字（整数）",
    action: convertFieldsToInteger,
    successMessage: "字段已设置为数字（整数）",
    pendingLabel: "设置中…",
  },
  {
    selector: "#fieldTypeDecimal2Button",
    actionLabel: "小数 0.00",
    action: convertFieldsToDecimal2,
    successMessage: "字段已设置为数字（保留两位小数）",
    pendingLabel: "设置中…",
  },
];

export function initFieldTypeTools() {
  for (const binding of BUTTON_BINDINGS) {
    const $button = $(binding.selector);
    if (!$button.length) continue;
    if ($button.data("field-type-bound")) continue;
    $button.data("field-type-bound", true);
    bindButtonEvent($button as JQuery<HTMLButtonElement>, binding);
  }
}

function bindButtonEvent(
  $button: JQuery<HTMLButtonElement>,
  config: ButtonBinding
) {
  let busy = false;

  if (typeof $button.data("original-label") !== "string") {
    $button.data("original-label", $button.text());
  } //存储初始文本, 以便恢复.促使文本就是在没有按下按钮的时候按钮上显示的那个文字. 这里只执行一次. 当original-label是空的时候才会去临时存储(用button.data临时存储).如果已经有了, 那么就不会去存储, 避免覆盖.

  $button.on("click", async () => {
    if (busy) return;

    try {
      busy = true;
      $button.prop("disabled", true); //prop是jquery的方法, 用来设置属性. 这里是把按钮禁用掉, 避免重复点击. prop=property
      if (config.pendingLabel) {
        $button.text(config.pendingLabel);
      }

      const fieldId = await getSelectedFieldId();
      if (!fieldId) {
        showError("请先在多维表格中选中需要修改的字段。");
        return;
      }

      const preparedOptions = config.prepare
        ? await config.prepare()
        : undefined;
      if (preparedOptions == null && config.prepare) {
        return;
      }

      const summary = await config.action(
        fieldId,
        createConversionHandlers(),
        preparedOptions
      );

      if (summary.applied > 0) {
        showToast(config.successMessage, "success");
      }

      if (summary.keptFormula > 0) {
        const infoMessage =
          summary.applied > 0
            ? `已保留 ${summary.keptFormula} 个公式字段，并更新其显示格式。`
            : `已保留 ${summary.keptFormula} 个公式字段，未改变字段类型。`;
        showToast(infoMessage, "info");
      }

      if (summary.applied === 0 && summary.keptFormula === 0) {
        showToast("未对任何字段进行修改。", "info");
      }
    } catch (error) {
      const message = (error as Error).message ?? "设置字段类型失败";
      if (message === FORMULA_ALREADY_TYPE_MESSAGE) {
        await showConfirmDialog({
          message,
          confirmText: "知道了",
          cancelText: "关闭",
          dismissible: true,
        });
      } else {
        showError(message);
      }
    } finally {
      busy = false;
      $button.prop("disabled", false);
      const storedLabel = $button.data("original-label");
      if (typeof storedLabel === "string") {
        $button.text(storedLabel);
      }
    } //这里的 finally 是 try/catch/finally 结构的一部分。它表示“无论前面的 try 块里的异步操作成功还是失败，都会执行这里的代码”。所以我们在 finally 里统一1. 把 busy 复位、2. 按钮解除禁用、3. 恢复原始文案. 保证状态无论成功或出错都能还原。
  });
}

function createConversionHandlers(): ConversionHandlers {
  return {
    resolveFormulaConflict: async ({ fieldName }) => {
      const displayName = fieldName || "未命名字段";
      const decision = await showConfirmDialog({
        message: `字段「${displayName}」是公式字段。请选择操作：`,
        confirmText: "保留公式",
        secondaryText: "彻底转换",
        cancelText: "取消",
      });

      if (decision === "dismiss" || decision === "cancel") {
        return "cancel";
      }

      if (decision === "confirm") {
        return "keep";
      }

      return "replace";
    },
  };
}

async function promptCurrencyOptions(): Promise<CurrencyConversionOptions | null> {
  const $container = $(
    `<div class="field-type-dialog">
      <label class="field-type-dialog__row">
        <span class="field-type-dialog__label">币种</span>
        <select class="field-type-dialog__select" data-role="currency">
          <option value="CNY">RMB</option>
          <option value="USD" selected>USD</option>
        </select>
      </label>
      <label class="field-type-dialog__row">
        <span class="field-type-dialog__label">数值格式</span>
        <select class="field-type-dialog__select" data-role="digits">
          <option value="0">金额</option>
          <option value="2" selected>价格</option>
        </select>
      </label>
    </div>`
  );

  const decision = await showConfirmDialog({
    title: "确认转换",
    message: $container,
    confirmText: "确定",
    cancelText: "取消",
    dismissible: true,
  });

  if (decision !== "confirm") {
    return null;
  }

  const currencyValue =
    ($container.find("select[data-role='currency']").val() as string | undefined) ??
    "CNY";
  const digitsValue =
    ($container.find("select[data-role='digits']").val() as string | undefined) ??
    "0";

  const currencyCode =
    currencyValue === "USD" ? CurrencyCode.USD : CurrencyCode.CNY;
  const decimalDigits = Number.parseInt(digitsValue as string, 10) || 0;

  return { currencyCode, decimalDigits };
}

async function promptDateOptions(): Promise<DateFieldConversionOptions | null> {
  const formatDecision = await showConfirmDialog({
    message: "日期字段显示格式",
    confirmText: "日期 + 时间",
    secondaryText: "仅日期",
    cancelText: "取消",
  });

  if (formatDecision === "dismiss" || formatDecision === "cancel") {
    return null;
  }

  const includeTime = formatDecision === "confirm";
  const dateFormat = includeTime
    ? DateFormatter.DATE_TIME_WITH_HYPHEN
    : DateFormatter.DATE_YMD_WITH_HYPHEN;

  const autoFillDecision = await showConfirmDialog({
    message: "是否自动填充创建时间？",
    confirmText: "自动填充",
    secondaryText: "不自动",
    cancelText: "取消",
  });

  if (autoFillDecision === "dismiss" || autoFillDecision === "cancel") {
    return null;
  }

  return {
    dateFormat,
    displayTimeZone: includeTime,
    autoFill: autoFillDecision === "confirm",
  };
}
