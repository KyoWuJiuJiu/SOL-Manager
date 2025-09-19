export type ToastVariant = "info" | "success" | "warning" | "danger";

function ensureToastInfra() {
  const styleId = "__sol_toast_style__";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .sol-toast-container{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none}
      .sol-toast{pointer-events:auto;min-width:240px;max-width:440px;background:#1f2937;color:#fff;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.25);padding:10px 12px;opacity:0;transform:translateY(6px);transition:opacity .2s ease,transform .2s ease;white-space:pre-wrap;word-break:break-word;font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
      .sol-toast.show{opacity:1;transform:translateY(0)}
      .sol-toast.info{background:#2563eb}
      .sol-toast.success{background:#16a34a}
      .sol-toast.warning{background:#fbbf24;color:#111827}
      .sol-toast.danger{background:#dc2626}
    `;
    document.head.appendChild(style);
  }

  let container = document.querySelector<HTMLDivElement>(".sol-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "sol-toast-container";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, variant: ToastVariant = "info", durationMs = 2800) {
  try {
    const container = ensureToastInfra();
    const toast = document.createElement("div");
    toast.className = `sol-toast ${variant}`;
    toast.textContent = message;
    container.appendChild(toast);
    void toast.offsetHeight;
    toast.classList.add("show");
    const timer = window.setTimeout(() => {
      toast.classList.remove("show");
      window.setTimeout(() => toast.remove(), 200);
    }, Math.max(durationMs, 1200));
    toast.addEventListener("click", () => {
      window.clearTimeout(timer);
      toast.classList.remove("show");
      window.setTimeout(() => toast.remove(), 120);
    });
  } catch (err) {
    console.warn("[Toast]", message, err);
  }
}

export function showError(message: string) {
  showToast(message, "danger");
}

export function logError(context: string, err: unknown) {
  console.error(`[${context}]`, err);
}
