import { mutate } from "swr";

export async function refreshFinancialData() {
  await mutate((key) => typeof key === "string" && (
    key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-")
  ), undefined, { revalidate: true });
}
