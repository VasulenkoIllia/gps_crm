import {
  idParamsSchema,
  passwordConfirmSchema,
  twoFactorConfirmSchema,
  type RecoveryCodes,
  type TwoFactorSetup,
} from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { activityContext, authenticated, can, requireAuth, sessionOrigin } from "../../core/access/access.js";
import { API_PREFIX, CREDENTIAL_RATE_LIMIT, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { setSessionCookie } from "../../core/session/session.cookie.js";
import * as service from "./two-factor.service.js";

const NO_CONTENT = 204;

export function registerTwoFactorRoutes(app: FastifyInstance, deps: AppDeps): void {
  const isSecure = deps.config.isProduction;

  app.post(
    `${API_PREFIX}/me/2fa/setup`,
    { config: { access: authenticated({ beforeTwoFactor: true }) } },
    (request): Promise<TwoFactorSetup> => service.beginSetup(deps, requireAuth(request)),
  );

  app.post(
    `${API_PREFIX}/me/2fa/confirm`,
    { config: { access: authenticated({ beforeTwoFactor: true }) } },
    async (request, reply): Promise<RecoveryCodes> => {
      const { code } = parseInput(twoFactorConfirmSchema, request.body);
      const context = activityContext(request);
      const auth = requireAuth(request);
      const { recoveryCodes, session } = await service.confirmSetup(deps, context, auth, code, sessionOrigin(request));
      setSessionCookie(reply, session.token, session.expiresAt, isSecure);
      return { recoveryCodes };
    },
  );

  app.post(
    `${API_PREFIX}/me/2fa/recovery-codes`,
    { config: { access: authenticated(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request): Promise<RecoveryCodes> => {
      const { password } = parseInput(passwordConfirmSchema, request.body);
      const context = activityContext(request);
      return { recoveryCodes: await service.regenerateRecoveryCodes(deps, context, requireAuth(request), password) };
    },
  );

  app.post(
    `${API_PREFIX}/users/:id/reset-2fa`,
    { config: { access: can("users.manage"), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request, reply) => {
      const { id } = parseInput(idParamsSchema, request.params);
      const { password } = parseInput(passwordConfirmSchema, request.body);
      await service.resetForUser(deps, activityContext(request), requireAuth(request), id, password);
      return reply.code(NO_CONTENT).send();
    },
  );
}
