import { formatDate } from "@/lib/utils";
import { isHistoryCivilDate } from "./history-query";

export function formatHistoryDateRange(start: string, end: string): string {
  const first = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  const month = new Intl.DateTimeFormat("en", { month: "short" });
  const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return `${month.format(first)} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`;
  }
  if (first.getFullYear() === last.getFullYear()) return `${shortDate.format(first)}–${shortDate.format(last)}, ${last.getFullYear()}`;
  const fullDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
  return `${fullDate.format(first)}–${fullDate.format(last)}`;
}

export function formatHistoryDate(value: string | null | undefined, style: "short" | "long" = "short"): string {
  return isHistoryCivilDate(value) ? formatDate(`${value}T12:00:00`, style) : "Unavailable";
}

export function formatHistoryMoney(value: string | number | null | undefined): string {
  const text = typeof value === "number" ? String(value) : value;
  const match = typeof text === "string" ? /^(\d+)(?:\.(\d{1,2}))?$/.exec(text) : null;
  if (!match) return "Unavailable";
  const whole = BigInt(match[1]).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return `₱${whole}.${fraction}`;
}
