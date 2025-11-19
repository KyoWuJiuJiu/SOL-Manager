import $ from "jquery";
import { bitable } from "@lark-base-open/js-sdk";
import { loadPluginContext, type PluginContext } from "../core/context";
import {
  runCalculation,
  runCduCalculation,
  type BufferUnit,
  type InnerMaterial,
} from "../core/calculator";
import { showError, showToast } from "../utils/logger";

import { initFieldTypeTools } from "./fieldTypeTools";
import { initViewTools } from "./viewTools";
import { showConfirmDialog } from "./dialogue";

function parseNumber($input: JQuery<HTMLInputElement>): number {
  const value = Number($input.val());
  return Number.isFinite(value) ? value : 0;
}

function appendLog($list: JQuery<HTMLElement>, message: string) {
  const $item = $("<li></li>");
  $item.text(message);
  $list.append($item);
}

function resetLog($list: JQuery<HTMLElement>) {
  $list.empty();
}

interface RefreshOptions {
  showLoading?: boolean;
}

export function bindUIEvents() {
  // ...existing code...
  const $status = $("#statusLine");
  const $missing = $("#missingFields");
  const $contextLabel = $("#contextLabel");
  const $logList = $("#logList");
  const $logPlaceholder = $("#logPlaceholder");
  const $calculateButton = $("#calculateButton");
  const $controls = $(".controls");
  const $overlapReset = $("#overlapReset");
  const $calculateCduButton = $("#calculateCduButton");
  const $cduWidthCount = $("#cduWidthCount") as JQuery<HTMLInputElement>;
  const $cduDepthCount = $("#cduDepthCount") as JQuery<HTMLInputElement>;
  const $cduHeightCount = $("#cduHeightCount") as JQuery<HTMLInputElement>;
  let context: PluginContext | null = null;
  let missingFields: string[] = [];
  let busy = false;
  let cduBusy = false;
  let listenersRegistered = false;
  let refreshScheduled = false;
  let tableListenerDisposers: Array<() => void> = [];

  function disposeTableListeners() {
    if (!tableListenerDisposers.length) return;
    for (const dispose of tableListenerDisposers) {
      try {
        dispose();
      } catch (err) {
        console.warn("取消表监听失败", err);
      }
    }
    tableListenerDisposers = [];
  }

  function registerTableListeners(table: any) {
    disposeTableListeners();
    const register = (target: any, method: string, handler: () => void) => {
      const fn = target?.[method];
      if (typeof fn !== "function") return;
      try {
        const disposer = fn.call(target, handler);
        if (typeof disposer === "function") {
          tableListenerDisposers.push(disposer);
        }
      } catch (err) {
        console.warn(`注册 ${method} 监听失败`, err);
      }
    };

    register(table, "onFieldChange", () => {
      void refreshContext();
    });
    register(table, "onRecordChange", () => {
      scheduleRefresh();
    });
    register(table, "onCellValueChange", () => {
      scheduleRefresh();
    });
    register(table, "onViewChange", () => {
      void refreshContext();
    });
  }

  function updateContextLabel(ctx: PluginContext | null) {
    if (!ctx) {
      $contextLabel.text("正在获取当前表和视图…");
      return;
    }
    const tableName = ctx.tableName || "未知";
    const viewName = ctx.viewName || "未知";
    $contextLabel.text(`当前表：${tableName} / 视图：${viewName}`);
  }

  function updateMissingFieldTips(list: string[]) {
    if (list.length) {
      $missing.text(`缺少以下字段，功能将受限：${list.join(", ")}`);
      $missing.show();
    } else {
      $missing.hide();
      $missing.empty();
    }
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    window.setTimeout(() => {
      refreshScheduled = false;
      void refreshContext();
    }, 200);
  }


  async function refreshContext(options: RefreshOptions = {}) {
    const { showLoading = false } = options;
    if (showLoading) {
      $status.text("正在初始化插件…").removeClass("error").show();
    }

    try {
      const { context: ctx, missingFields: missing } =
        await loadPluginContext();
      context = ctx;
      missingFields = missing;
      updateContextLabel(ctx);
      updateMissingFieldTips(missing);
      registerTableListeners(ctx.table);
      if (showLoading) {
        $status.empty().removeClass("error").hide();
      }

      registerBaseListeners();
    } catch (err) {
      const message = (err as Error).message ?? "初始化失败";
      if (showLoading) {
        $status.text(message).addClass("error").show();
      }
      showError(message);
    }
  }

  function registerBaseListeners() {
    if (listenersRegistered) return;
    listenersRegistered = true;

    try {
      bitable.base.onTableChange?.(() => {
        void refreshContext();
      });
      bitable.base.onViewChange?.(() => {
        void refreshContext();
      });
      bitable.base.onSelectionChange?.(() => {
        scheduleRefresh();
      });
    } catch (err) {
      console.warn("注册表/视图监听失败", err);
    }
  }

  function withLogs(message: string) {
    if ($logPlaceholder.length) {
      $logPlaceholder.hide();
    }
    appendLog($logList, message);
  }

  function resetLogs() {
    resetLog($logList);
    $logPlaceholder.show();
  }

  function resetOverlapFields() {
    ($("#overlapHeight") as JQuery<HTMLInputElement>).val("0");
    ($("#overlapWidth") as JQuery<HTMLInputElement>).val("0");
    ($("#overlapDepth") as JQuery<HTMLInputElement>).val("0");
    ($("#overlapUnit") as JQuery<HTMLSelectElement>).val("cm");
  }

  $overlapReset.on("click", () => {
    resetOverlapFields();
  });

  $controls.on("keydown", (event) => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== "input" && tag !== "select") return;
    if (target === $calculateButton.get(0) || target === $overlapReset.get(0)) {
      return;
    }
    event.preventDefault();
    if (!$calculateButton.prop("disabled")) {
      $calculateButton.trigger("click");
    }
  });

  $calculateButton.on("click", async () => {
    if (!context) {
      showError("插件尚未准备就绪，稍后再试。");
      return;
    }
    if (busy) return;
    if (missingFields.length) {
      showError(`缺少字段，无法计算：${missingFields.join(", ")}`);
      return;
    }

    const forceAll = $("#selectAllCheckbox").prop("checked");

    if (!forceAll) {
      try {
        const selectedIds = await context.view.getSelectedRecordIdList();
        const hasSelection =
          Array.isArray(selectedIds) && selectedIds.some(Boolean);
        if (!hasSelection) {
          const overlapValues = [
            parseNumber($("#overlapWidth") as JQuery<HTMLInputElement>),
            parseNumber($("#overlapDepth") as JQuery<HTMLInputElement>),
            parseNumber($("#overlapHeight") as JQuery<HTMLInputElement>),
          ];
          const positiveOverlap = overlapValues.some((val) => val !== 0);
          const message = positiveOverlap
            ? "Warning! 你选择了 overlap，并且没有选中具体记录。确认是否要对全部产品套用当前 overlap？"
            : "未选择任何记录，是否计算当前视图的全部记录？";

          const decision = await showConfirmDialog({
            message,
            confirmText: "确认",
            cancelText: "取消",
          });
          if (decision !== "confirm") {
            return;
          }
        }
      } catch (err) {
        console.warn("获取选中记录失败", err);
      }
    }

    busy = true;
    $calculateButton.prop("disabled", true).text("计算中…");
    resetLogs();

    const innerBuffer = parseNumber(
      $("#innerBuffer") as JQuery<HTMLInputElement>
    );
    const masterBuffer = parseNumber(
      $("#masterBuffer") as JQuery<HTMLInputElement>
    );
    const bufferUnit = $("#bufferUnit").val() as BufferUnit;
    const innerMaterial = $("#innerMaterial").val() as InnerMaterial;
    const overlapHeight = parseNumber(
      $("#overlapHeight") as JQuery<HTMLInputElement>
    );
    const overlapWidth = parseNumber(
      $("#overlapWidth") as JQuery<HTMLInputElement>
    );
    const overlapDepth = parseNumber(
      $("#overlapDepth") as JQuery<HTMLInputElement>
    );
    const overlapUnit = $("#overlapUnit").val() as BufferUnit;
    try {
      await runCalculation(context, {
        forceAll,
        innerBuffer,
        innerBufferUnit: bufferUnit,
        masterBuffer,
        masterBufferUnit: bufferUnit,
        innerMaterial,
        overlapHeight,
        overlapWidth,
        overlapDepth,
        overlapUnit,
        onLog: withLogs,
      });
      showToast("计算完成", "success");
    } catch (err) {
      const message = (err as Error).message ?? "计算失败";
      showError(message);
    } finally {
      busy = false;
      $calculateButton.prop("disabled", false).text("开始计算");
    }
  });

  $calculateCduButton.on("click", async () => {
    if (!context) {
      showError("插件尚未准备就绪，稍后再试。");
      return;
    }
    if (cduBusy) return;
    const widthCount = Math.floor(parseNumber($cduWidthCount));
    const depthCount = Math.floor(parseNumber($cduDepthCount));
    const heightCount = Math.floor(parseNumber($cduHeightCount));
    if (widthCount <= 0 || depthCount <= 0 || heightCount <= 0) {
      showError("请填写 CDU 的宽/深/高个数。");
      return;
    }

    let recordIds: string[] = [];
    try {
      const selected = await context.view.getSelectedRecordIdList();
      recordIds = Array.isArray(selected)
        ? selected.filter((id): id is string => Boolean(id))
        : [];
    } catch (error) {
      console.warn("获取选中记录失败", error);
    }

    if (!recordIds.length) {
      showError("CDU 计算只支持已选定的记录，请先选中需要处理的行。");
      return;
    }

    const overlapHeight = parseNumber(
      $("#overlapHeight") as JQuery<HTMLInputElement>
    );
    const overlapWidth = parseNumber(
      $("#overlapWidth") as JQuery<HTMLInputElement>
    );
    const overlapDepth = parseNumber(
      $("#overlapDepth") as JQuery<HTMLInputElement>
    );
    const overlapUnit = $("#overlapUnit").val() as BufferUnit;
    const masterBuffer = parseNumber(
      $("#masterBuffer") as JQuery<HTMLInputElement>
    );
    const bufferUnit = $("#bufferUnit").val() as BufferUnit;

    try {
      cduBusy = true;
      $calculateCduButton.prop("disabled", true).text("计算中…");
      resetLogs();
      await runCduCalculation(context, {
        recordIds,
        widthCount,
        depthCount,
        heightCount,
        masterBuffer,
        masterBufferUnit: bufferUnit,
        overlapWidth,
        overlapDepth,
        overlapHeight,
        overlapUnit,
        onLog: withLogs,
      });
      showToast("CDU 计算完成", "success");
    } catch (error) {
      const message = (error as Error).message ?? "CDU 计算失败";
      showError(message);
    } finally {
      cduBusy = false;
      $calculateCduButton.prop("disabled", false).text("计算CDU");
    }
  });

  void refreshContext({ showLoading: true });
  initFieldTypeTools();
  initViewTools();
}
