import { searchQuerySchema, type Home, type PermissionKey, type SearchResult } from "@gps_crm/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { can, recordScope, recordScopeOf, requireAuth, type RecordScope } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { readHome } from "./home.service.js";
import { search } from "./search.service.js";

// The level of a permission the route itself does not require: none means that part is not read for this person
function scopeIfAllowed(request: FastifyRequest, key: PermissionKey): RecordScope | null {
  return requireAuth(request).permissions.has(key) ? recordScopeOf(request, key) : null;
}

export function registerSearchRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("subscribers.read") } };

  app.get(`${API_PREFIX}/search`, read, (request): Promise<SearchResult> => {
    const query = parseInput(searchQuerySchema, request.query);
    return search(deps, query, {
      clients: recordScope(request),
      objects: scopeIfAllowed(request, "objects.read"),
      hasEquipment: requireAuth(request).permissions.has("equipment.read"),
    });
  });

  app.get(`${API_PREFIX}/home`, read, (request): Promise<Home> => {
    return readHome(deps.db, requireAuth(request).userId, {
      clients: recordScope(request),
      objects: scopeIfAllowed(request, "objects.read"),
      activity: scopeIfAllowed(request, "activity.read"),
    });
  });
}
