import { z } from "zod";

export type Money = string;
const safeCentavos = (amount: string) => Number.isSafeInteger(Number(amount.replace(".", "")));
export const MoneySchema = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine(safeCentavos, "Amount exceeds safe centavo range");
export const SignedMoneySchema = z.string().regex(/^-?(0|[1-9]\d*)\.\d{2}$/).refine(amount => amount !== "-0.00" && safeCentavos(amount), "Invalid signed amount or unsafe centavo range");
export const PositiveMoneySchema = MoneySchema.refine(amount => amount !== "0.00", "Amount must be positive");
