/**
 * Utilities for resilient account/wallet ordering.
 * Supports both database display_order and user-scoped localStorage caching.
 */

const ORDER_STORAGE_PREFIX = "monetigia:accounts-order:";

export function getStoredAccountOrder(userId?: string | null): string[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = localStorage.getItem(`${ORDER_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function setStoredAccountOrder(userId: string, accountIds: string[]): void {
  if (typeof window === "undefined" || !userId || !Array.isArray(accountIds)) return;
  try {
    localStorage.setItem(
      `${ORDER_STORAGE_PREFIX}${userId}`,
      JSON.stringify(accountIds.filter(Boolean))
    );
  } catch {
    // ignore storage quota errors
  }
}

export function sortAccountsWithFallback<
  T extends { id: string; display_order?: number | null; created_at?: string }
>(accounts: T[], userId?: string | null): T[] {
  if (!accounts || accounts.length <= 1) return accounts || [];

  const storedOrder = getStoredAccountOrder(userId);
  const storedIndexMap = new Map<string, number>();
  storedOrder.forEach((id, index) => {
    storedIndexMap.set(id, index);
  });

  // Check if database display_order has distinct non-zero values
  const hasDbDisplayOrder = accounts.some(
    (a) => typeof a.display_order === "number" && a.display_order > 0
  );

  return [...accounts].sort((a, b) => {
    // 1. If database has valid distinct display_order, respect it
    if (hasDbDisplayOrder) {
      const orderA = typeof a.display_order === "number" ? a.display_order : 999999;
      const orderB = typeof b.display_order === "number" ? b.display_order : 999999;
      if (orderA !== orderB) return orderA - orderB;
    }

    // 2. Fall back to user-saved local ordering
    const indexA = storedIndexMap.get(a.id);
    const indexB = storedIndexMap.get(b.id);

    if (indexA !== undefined && indexB !== undefined) {
      return indexA - indexB;
    }
    if (indexA !== undefined) return -1;
    if (indexB !== undefined) return 1;

    // 3. Fall back to created_at
    const dateA = a.created_at || "";
    const dateB = b.created_at || "";
    return dateA.localeCompare(dateB);
  });
}
