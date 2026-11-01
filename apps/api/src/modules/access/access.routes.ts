import type { PermissionList } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { authenticated, requireAuth } from "../../core/access/access.js";
import { API_PREFIX } from "../../core/deps.js";

// What useCan reads to hide buttons. The server decides on its own at every route (П4).
export function registerAccessRoutes(app: FastifyInstance): void {
  app.get(`${API_PREFIX}/me/permissions`, { config: { access: authenticated() } }, (request): PermissionList => {
    const { permissions } = requireAuth(request);
    return { permissions: [...permissions].map(([key, scope]) => ({ key, scope })) };
  });
}
