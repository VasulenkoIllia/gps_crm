import { z } from "zod";

const DEFAULT_PORT = 3000;
const DEFAULT_SMTP_PORT = 587;
const MAX_PORT = 65_535;
const SECRETS_KEY_BYTES = 32;
// The Vite dev server: in development the browser's Origin is this one, not the API's
const DEV_APP_URL = "http://localhost:5173";

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
  APP_URL: withDefault(z.url({ protocol: /^https?$/ }).optional()),
  SECRETS_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === SECRETS_KEY_BYTES, "must be 32 bytes in base64"),
  SMTP_HOST: withDefault(z.string().optional()),
  SMTP_PORT: withDefault(z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_SMTP_PORT)),
  SMTP_USER: withDefault(z.string().optional()),
  SMTP_PASSWORD: withDefault(z.string().optional()),
  SMTP_FROM: withDefault(z.string().optional()),
});

export type AppRole = z.infer<typeof envSchema>["APP_ROLE"];

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  auth: { user: string; pass: string } | null;
}

export interface AppConfig {
  isProduction: boolean;
  appRole: AppRole;
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  // Origin of the web app: the base of the links in letters and what the Origin check compares with
  appUrl: string;
  secretsKey: Buffer;
  // Null means no letters: links are passed by hand (D12)
  smtp: SmtpConfig | null;
}

type ParsedEnv = z.infer<typeof envSchema>;

function smtpConfigOf(data: ParsedEnv): SmtpConfig | null {
  if (!data.SMTP_HOST) return null;
  if (!data.SMTP_FROM) throw new Error("Invalid environment (see .env.example): SMTP_FROM: needed with SMTP_HOST");
  if (Boolean(data.SMTP_USER) !== Boolean(data.SMTP_PASSWORD)) {
    throw new Error("Invalid environment (see .env.example): SMTP_USER and SMTP_PASSWORD go together");
  }
  const auth = data.SMTP_USER && data.SMTP_PASSWORD ? { user: data.SMTP_USER, pass: data.SMTP_PASSWORD } : null;
  return { host: data.SMTP_HOST, port: data.SMTP_PORT, from: data.SMTP_FROM, auth };
}

function appUrlOf(data: ParsedEnv): string {
  if (data.APP_URL) return new URL(data.APP_URL).origin;
  if (data.NODE_ENV === "production") throw new Error("Invalid environment (see .env.example): APP_URL: required");
  return DEV_APP_URL;
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
    appUrl: appUrlOf(data),
    secretsKey: Buffer.from(data.SECRETS_KEY, "base64"),
    smtp: smtpConfigOf(data),
  };
}
