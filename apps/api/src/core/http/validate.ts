import type { z } from "zod";
import { AppError } from "../errors.js";

const VALIDATION_FAILED = "Перевірте заповнені поля";

// Handlers call this first, so a request that fails the access check is not even parsed
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors = Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
  throw new AppError(400, "validation_failed", VALIDATION_FAILED, fieldErrors);
}
