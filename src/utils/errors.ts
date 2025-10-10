export function mapPermissionError(error: unknown): Error | null {
  if (!error) return null;

  const rawMessage =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown }).message === "string"
      ? ((error as { message: string }).message as string)
      : "";
  const codes = [
    (error as { code?: string }).code,
    (error as { errorCode?: string }).errorCode,
    (error as { error_code?: string }).error_code,
  ].filter(Boolean) as string[];

  const message = rawMessage || codes.join("") || "";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    message.includes("权限") ||
    codes.some((code) =>
      typeof code === "string"
        ? ["permission", "forbidden", "unauthorized"].some((key) =>
            code.toLowerCase().includes(key)
          )
        : false
    )
  ) {
    return new Error("你没有编辑权限");
  }

  return null;
}
