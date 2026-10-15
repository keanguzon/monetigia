import { expect, test } from "vitest";
import { formatHistoryMoney } from "@/lib/transactions/history-format";

test("formats history as pesos without currency metadata or lost centavos", () => {
  expect(formatHistoryMoney("0.00")).toBe("₱0.00");
  expect(formatHistoryMoney("12.50")).toBe("₱12.50");
  expect(formatHistoryMoney("900719925474099.93")).toBe("₱900,719,925,474,099.93");
  expect(formatHistoryMoney("NaN")).toBe("Unavailable");
});
