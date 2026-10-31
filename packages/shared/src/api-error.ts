import { z } from "zod";

// The format of every error answer, as in 07-extensibility.md §7.3
const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

// Undefined when the body is not in this format: a proxy in front of the API answers with its own pages
export function parseApiError(body: unknown): ApiErrorBody | undefined {
  return apiErrorSchema.safeParse(body).data;
}
