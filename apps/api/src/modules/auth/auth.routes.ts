import {
  LOGIN_STATUS,
  idParamsSchema,
  loginInputSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  reinviteInputSchema,
  twoFactorLoginInputSchema,
  type LinkDelivery,
  type LoginResult,
  type SessionList,
} from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import {
  activityContext,
  authenticated,
  can,
  publicRoute,
  requireAuth,
  sessionOrigin,
} from "../../core/access/access.js";
import { API_PREFIX, CREDENTIAL_RATE_LIMIT, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { clearSessionCookie, setSessionCookie } from "../../core/session/session.cookie.js";
import * as service from "./auth.service.js";

const NO_CONTENT = 204;

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const isSecure = deps.config.isProduction;

  app.post(
    `${API_PREFIX}/auth/login`,
    { config: { access: publicRoute(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request, reply): Promise<LoginResult> => {
      const input = parseInput(loginInputSchema, request.body);
      const outcome = await service.login(deps, activityContext(request), input, sessionOrigin(request));
      if (outcome.session) setSessionCookie(reply, outcome.session.token, outcome.session.expiresAt, isSecure);
      return outcome.result;
    },
  );

  app.post(
    `${API_PREFIX}/auth/2fa`,
    { config: { access: publicRoute(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request, reply): Promise<LoginResult> => {
      const input = parseInput(twoFactorLoginInputSchema, request.body);
      const session = await service.loginSecondStep(deps, activityContext(request), input, sessionOrigin(request));
      setSessionCookie(reply, session.token, session.expiresAt, isSecure);
      return { status: LOGIN_STATUS.signedIn };
    },
  );

  app.post(
    `${API_PREFIX}/auth/logout`,
    { config: { access: authenticated({ beforeTwoFactor: true }) } },
    async (request, reply) => {
      await service.logout(deps, activityContext(request), requireAuth(request));
      clearSessionCookie(reply, isSecure);
      return reply.code(NO_CONTENT).send();
    },
  );

  // Answered before the work is done: the time must not say whether the address has an account
  app.post(
    `${API_PREFIX}/auth/password-reset`,
    { config: { access: publicRoute(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    (request, reply) => {
      const { email } = parseInput(passwordResetRequestSchema, request.body);
      service.requestPasswordReset(deps, activityContext(request), email).catch((error: unknown) => {
        request.log.error({ err: error }, "password reset request failed");
      });
      return reply.code(NO_CONTENT).send();
    },
  );

  app.post(
    `${API_PREFIX}/auth/password-reset/confirm`,
    { config: { access: publicRoute(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseInput(passwordResetConfirmSchema, request.body);
      await service.confirmPasswordReset(deps, activityContext(request), input);
      return reply.code(NO_CONTENT).send();
    },
  );

  app.post(
    `${API_PREFIX}/me/password`,
    { config: { access: authenticated(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseInput(passwordChangeSchema, request.body);
      await service.changePassword(deps, activityContext(request), requireAuth(request), input);
      return reply.code(NO_CONTENT).send();
    },
  );

  app.get(
    `${API_PREFIX}/me/sessions`,
    { config: { access: authenticated() } },
    async (request): Promise<SessionList> => {
      return { items: await service.listSessions(deps, requireAuth(request)) };
    },
  );

  // «Вийти всюди»: this browser included, so the person ends up on the login page like every other device
  app.delete(`${API_PREFIX}/me/sessions`, { config: { access: authenticated() } }, async (request, reply) => {
    await service.logoutEverywhere(deps, activityContext(request), requireAuth(request));
    clearSessionCookie(reply, isSecure);
    return reply.code(NO_CONTENT).send();
  });

  app.delete(`${API_PREFIX}/me/sessions/:id`, { config: { access: authenticated() } }, async (request, reply) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const auth = requireAuth(request);
    await service.endSession(deps, activityContext(request), auth, id);
    if (id === auth.sessionId) clearSessionCookie(reply, isSecure);
    return reply.code(NO_CONTENT).send();
  });

  app.post(
    `${API_PREFIX}/users/:id/password-reset`,
    { config: { access: can("users.manage") } },
    (request): Promise<LinkDelivery> => {
      const { id } = parseInput(idParamsSchema, request.params);
      const { sendEmail } = parseInput(reinviteInputSchema, request.body ?? {});
      return service.createPasswordResetLink(deps, activityContext(request), id, sendEmail);
    },
  );
}
