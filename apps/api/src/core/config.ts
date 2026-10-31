import { z } from "zod";

const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

// A key left empty in .env falls back to its default, never to ""
function withDefault<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const envSchema = z.object({
  NODE_ENV: withDefault(z.enum(["development", "test", "production"]).default("development")),
  APP_ROLE: withDefault(z.enum(["all", "api", "worker"]).default("all")),
  // Local development listens on this machine only; the image sets HOST=0.0.0.0
  HOST: withDefault(z.string().default("127.0.0.1")),
  PORT: withDefault(z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_PORT)),
  LOG_LEVEL: withDefault(z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type AppRole = z.infer<typeof envSchema>["APP_ROLE"];

export interface AppConfig {
  isProduction: boolean;
  appRole: AppRole;
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
}

// Only variable names and rule texts reach the message: a broken DATABASE_URL must not print its password
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment (see .env.example): ${problems.join("; ")}`);
  }
  const { data } = parsed;
  return {
    isProduction: data.NODE_ENV === "production",
    appRole: data.APP_ROLE,
    host: data.HOST,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    databaseUrl: data.DATABASE_URL,
  };
}
