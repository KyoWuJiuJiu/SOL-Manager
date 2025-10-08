import $ from "jquery";

const $confirmOverlay = $("#confirmOverlay");
const $confirmMessage = $("#confirmMessage");
const $confirmTitle = $("#confirmTitle");
const $confirmOk = $("#confirmOk");
const $confirmCancel = $("#confirmCancel");
const $confirmSecondary = $("#confirmSecondary");
const confirmOverlayEl = $confirmOverlay.get(0);

const originalTitleText = $confirmTitle.text();
const originalMessageHtml = $confirmMessage.html() ?? "";
const originalConfirmText = $confirmOk.text();
const originalCancelText = $confirmCancel.text();
const originalSecondaryText = $confirmSecondary.text();

interface ConfirmOptions {
  title?: string;
  message: string | JQuery<HTMLElement>;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  dismissible?: boolean;
}

export function showConfirmDialog({
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  secondaryText,
  dismissible = true,
}: ConfirmOptions): Promise<"confirm" | "secondary" | "cancel" | "dismiss"> {
  if (
    !$confirmOverlay.length ||
    !$confirmMessage.length ||
    !$confirmOk.length ||
    !$confirmCancel.length ||
    !confirmOverlayEl
  ) {
    const result = window.confirm(typeof message === "string" ? message : message.text());
    return Promise.resolve(result ? "confirm" : "cancel");
  }

  return new Promise((resolve) => {
    const hasSecondary = Boolean(secondaryText);
    if (title) {
      $confirmTitle.text(title);
    }

    if (typeof message === "string") {
      $confirmMessage.text(message);
    } else {
      $confirmMessage.empty().append(message);
    }
    $confirmOk.text(confirmText);
    $confirmCancel.text(cancelText);
    if (hasSecondary) {
      $confirmSecondary.text(secondaryText as string);
      $confirmSecondary.removeAttr("hidden");
    } else {
      $confirmSecondary.attr("hidden", "hidden");
    }
    $confirmOverlay.removeAttr("hidden");

    const cleanup = (
      result: "confirm" | "secondary" | "cancel" | "dismiss"
    ) => {
      $confirmOverlay.attr("hidden", "hidden");
      $confirmOk.off("click", onOk);
      $confirmCancel.off("click", onCancel);
      $confirmOverlay.off("click", onOverlayClick);
      $(document).off("keydown", onKeyDown);
      if (hasSecondary) {
        $confirmSecondary.off("click", onSecondary);
      }
      $confirmTitle.text(originalTitleText);
      $confirmMessage.html(originalMessageHtml);
      $confirmOk.text(originalConfirmText);
      $confirmCancel.text(originalCancelText);
      $confirmSecondary.text(originalSecondaryText);
      $confirmSecondary.attr("hidden", "hidden");
      resolve(result);
    };
    const onOk = () => cleanup("confirm");
    const onCancel = () => cleanup("cancel");
    const onSecondary = () => cleanup("secondary");
    const onOverlayClick = (evt: JQuery.ClickEvent) => {
      if (evt.target === confirmOverlayEl) {
        cleanup("dismiss");
      }
    };
    const onKeyDown = (evt: JQuery.KeyDownEvent) => {
      if (evt.key === "Escape") {
        cleanup("dismiss");
      }
    };
    $confirmOk.one("click", onOk);
    $confirmCancel.one("click", onCancel);
    if (hasSecondary) {
      $confirmSecondary.one("click", onSecondary);
    }
    if (dismissible) {
      $confirmOverlay.on("click", onOverlayClick);
      $(document).on("keydown", onKeyDown);
    }
  });
}
