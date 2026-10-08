import { z } from "zod";

export const MAX_BUDGET_MICROS = 100_000_000;

export const budgetUpdateSchema = z
  .object({
    micros: z.number().int().min(0).max(MAX_BUDGET_MICROS),
    expectedMicros: z.number().int().min(0),
  })
  .strict();

export type InstanceBudget = {
  monthlyCapMicros: number;
  monthlyConsumedMicros: number;
  monthlyRemainingMicros: number;
  monthlyPeriod: string;
  creditRemainingMicros: number;
};
