import { z } from "zod";

export const HEALTH_STATUS = { ok: "ok", unavailable: "unavailable" } as const;

const healthResponseSchema = z.strictObject({ status: z.enum([HEALTH_STATUS.ok, HEALTH_STATUS.unavailable]) });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export function parseHealthResponse(body: unknown): HealthResponse {
  return healthResponseSchema.parse(body);
}
