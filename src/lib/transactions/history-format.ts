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
