import {
  idParamsSchema,
  invitationAcceptSchema,
  invitationInputSchema,
  profileUpdateSchema,
  reinviteInputSchema,
  userListQuerySchema,
  type CurrentUser,
  type LinkDelivery,
  type UserList,
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
import { setSessionCookie } from "../../core/session/session.cookie.js";
import * as service from "./users.service.js";

const NO_CONTENT = 204;

export function registerUsersRoutes(app: FastifyInstance, deps: AppDeps): void {
  const isSecure = deps.config.isProduction;

  app.post(
    `${API_PREFIX}/invitations/accept`,
    { config: { access: publicRoute(), rateLimit: CREDENTIAL_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseInput(invitationAcceptSchema, request.body);
      const session = await service.acceptInvitation(deps, input, sessionOrigin(request), request.id);
      setSessionCookie(reply, session.token, session.expiresAt, isSecure);
      return reply.code(NO_CONTENT).send();
    },
  );

  // Open before 2FA: this is what tells the web app to send the person to the setup
  app.get(
    `${API_PREFIX}/me`,
    { config: { access: authenticated({ beforeTwoFactor: true }) } },
    (request): CurrentUser => service.toCurrentUser(requireAuth(request)),
  );

  app.patch(`${API_PREFIX}/me`, { config: { access: authenticated() } }, (request): Promise<CurrentUser> => {
    const input = parseInput(profileUpdateSchema, request.body);
    return service.updateProfile(deps, activityContext(request), requireAuth(request), input);
  });

  app.get(`${API_PREFIX}/users`, { config: { access: can("users.manage") } }, (request): Promise<UserList> => {
    return service.listUsers(deps.db, parseInput(userListQuerySchema, request.query));
  });

  app.post(
    `${API_PREFIX}/users/invitations`,
    { config: { access: can("users.manage") } },
    (request): Promise<LinkDelivery> => {
      return service.inviteUser(deps, activityContext(request), parseInput(invitationInputSchema, request.body));
    },
  );

  app.post(
    `${API_PREFIX}/users/:id/reinvite`,
    { config: { access: can("users.manage") } },
    (request): Promise<LinkDelivery> => {
      const { id } = parseInput(idParamsSchema, request.params);
      const input = parseInput(reinviteInputSchema, request.body ?? {});
      return service.reinviteUser(deps, activityContext(request), id, input);
    },
  );

  app.post(`${API_PREFIX}/users/:id/block`, { config: { access: can("users.manage") } }, async (request, reply) => {
    const { id } = parseInput(idParamsSchema, request.params);
    await service.blockUser(deps, activityContext(request), id);
    return reply.code(NO_CONTENT).send();
  });

  app.post(`${API_PREFIX}/users/:id/unblock`, { config: { access: can("users.manage") } }, async (request, reply) => {
    const { id } = parseInput(idParamsSchema, request.params);
    await service.unblockUser(deps, activityContext(request), id);
    return reply.code(NO_CONTENT).send();
  });
}
