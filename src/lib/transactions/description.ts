export function normalizeTransactionDescription(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/^[\u0009-\u000D\u0020]+|[\u0009-\u000D\u0020]+$/g, "");
  return normalized === "" ? null : normalized;
}
