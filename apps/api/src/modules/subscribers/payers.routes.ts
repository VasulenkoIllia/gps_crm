import {
  payerCreateSchema,
  payerLinkParamsSchema,
  payerSearchQuerySchema,
  payerUpdateSchema,
  type PayerList,
} from "@gps_crm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { activityContext, can, recordScope } from "../../core/access/access.js";
import { API_PREFIX } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { archivePayer, restoreRecord, type PackageDeps } from "./archive.service.js";
import {
  createPayer,
  linkPayerToSubscriber,
  listSubscriberPayers,
  searchPayerList,
  unlinkPayerFromSubscriber,
  updatePayer,
} from "./payers.service.js";
import { changing, creating, idOf } from "../../core/http/route-helpers.js";
import { findRecordBatchId } from "./subscribers.read.service.js";

const OF_CLIENT = `${API_PREFIX}/subscribers/:id/payers`;
const PATH = `${API_PREFIX}/payers`;
const NO_CONTENT = 204;

// Two ids in the path, so `changing` does not fit
function linkRoute(work: (request: FastifyRequest, id: string, payerId: string) => Promise<void>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, payerId } = parseInput(payerLinkParamsSchema, request.params);
    await work(request, id, payerId);
    return reply.code(NO_CONTENT).send();
  };
}

export function registerPayerRoutes(app: FastifyInstance, deps: PackageDeps): void {
  const read = { config: { access: can("subscribers.read") } };
  const write = { config: { access: can("subscribers.write") } };
  const archive = { config: { access: can("records.archive") } };

  app.get(OF_CLIENT, read, (request): Promise<PayerList> => {
    return listSubscriberPayers(deps, recordScope(request), idOf(request));
  });

  app.post(
    OF_CLIENT,
    write,
    creating((request) => {
      const input = parseInput(payerCreateSchema, request.body);
      return createPayer(deps, activityContext(request), recordScope(request), idOf(request), input);
    }),
  );

  app.post(
    `${OF_CLIENT}/:payerId/link`,
    write,
    linkRoute((request, id, payerId) =>
      linkPayerToSubscriber(deps, activityContext(request), recordScope(request), id, payerId),
    ),
  );

  app.delete(
    `${OF_CLIENT}/:payerId/link`,
    write,
    linkRoute((request, id, payerId) =>
      unlinkPayerFromSubscriber(deps, activityContext(request), recordScope(request), id, payerId),
    ),
  );

  app.get(PATH, read, (request): Promise<PayerList> => {
    return searchPayerList(deps, parseInput(payerSearchQuerySchema, request.query), recordScope(request));
  });

  app.patch(
    `${PATH}/:id`,
    write,
    changing((request, id) => {
      const input = parseInput(payerUpdateSchema, request.body);
      return updatePayer(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/archive`,
    archive,
    changing((request, id) => archivePayer(deps, activityContext(request), recordScope(request), id)),
  );

  app.post(
    `${PATH}/:id/restore`,
    archive,
    changing(async (request, id) => {
      const scope = recordScope(request);
      const batchId = await findRecordBatchId(deps, "payer", id, scope);
      await restoreRecord(deps, activityContext(request), scope, batchId);
    }),
  );
}
