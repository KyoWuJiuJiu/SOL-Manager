import $ from "jquery";
import { bitable } from "@lark-base-open/js-sdk";
import { loadPluginContext, type PluginContext } from "../core/context";
import { runCalculation, type BufferUnit, type InnerMaterial } from "../core/calculator";
import { showError, showToast } from "../utils/logger";

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
  const $status = $("#statusLine");
  const $missing = $("#missingFields");
  const $contextLabel = $("#contextLabel");
  const $logList = $("#logList");
  const $logPlaceholder = $("#logPlaceholder");
  const $calculateButton = $("#calculateButton");

  let context: PluginContext | null = null;
  let missingFields: string[] = [];
  let busy = false;
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
      const { context: ctx, missingFields: missing } = await loadPluginContext();
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
        const hasSelection = Array.isArray(selectedIds) && selectedIds.some(Boolean);
        if (!hasSelection) {
          const confirmed = window.confirm("未选择记录，是否计算当前视图全部记录？");
          if (!confirmed) {
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

    const innerBuffer = parseNumber($("#innerBuffer") as JQuery<HTMLInputElement>);
    const masterBuffer = parseNumber($("#masterBuffer") as JQuery<HTMLInputElement>);
    const bufferUnit = $("#bufferUnit").val() as BufferUnit;
    const innerMaterial = $("#innerMaterial").val() as InnerMaterial;

    try {
      await runCalculation(context, {
        forceAll,
        innerBuffer,
        innerBufferUnit: bufferUnit,
        masterBuffer,
        masterBufferUnit: bufferUnit,
        innerMaterial,
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

  void refreshContext({ showLoading: true });
}
