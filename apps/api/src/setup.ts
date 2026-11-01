import { z } from "zod";
import { emailSchema, fullNameSchema } from "@gps_crm/shared";
import { setAppRolePassword } from "./core/db/app-role.repository.js";
import { createDbClient } from "./core/db/client.js";
import { createLogger } from "./core/logger.js";
import { countUsers, ensureFirstAdmin } from "./modules/users/index.js";

// Runs once per deploy, right after the migrations and as the schema owner (the `migrate` service of infra/compose.yml;
// `npm run db:setup` locally). Its output reaches the public CI log: no email, no password, no token.
const envSchema = z.object({
  MIGRATION_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string(),
  // Letters and digits only, as it also stands in the URL of the running app
  APP_DB_PASSWORD: z.string().regex(/^[A-Za-z0-9]{16,}$/, "letters and digits, 16 or more"),
  FIRST_ADMIN_EMAIL: z.preprocess((value) => value || undefined, emailSchema.optional()),
  FIRST_ADMIN_NAME: z.preprocess((value) => value || undefined, fullNameSchema.optional()),
  FIRST_ADMIN_PASSWORD: z.preprocess((value) => value || undefined, z.string().optional()),
});

const FIRST_ADMIN_VARS = ["FIRST_ADMIN_EMAIL", "FIRST_ADMIN_NAME", "FIRST_ADMIN_PASSWORD"] as const;

const logger = createLogger("info");
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment (see .env.example): ${problems.join("; ")}`);
}
const env = parsed.data;

const db = createDbClient(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, (error) => {
  logger.error({ err: error }, "database pool error");
});

try {
  await setAppRolePassword(db, env.APP_DB_PASSWORD);
  logger.info("runtime role ready");

  const { FIRST_ADMIN_EMAIL: email, FIRST_ADMIN_NAME: fullName, FIRST_ADMIN_PASSWORD: password } = env;
  if (email && fullName && password) {
    const isCreated = await ensureFirstAdmin({ db }, { email, fullName, password });
    logger.info(isCreated ? "first administrator created" : "users exist, first administrator left alone");
  } else {
    const missing = FIRST_ADMIN_VARS.filter((name) => !env[name]);
    if (missing.length < FIRST_ADMIN_VARS.length) {
      logger.warn({ missing }, "first administrator skipped: some values are missing");
    } else if ((await countUsers(db)) === 0) {
      logger.warn("no users yet and no FIRST_ADMIN_* values: nobody can sign in");
    }
  }
} finally {
  await db.$disconnect();
}
