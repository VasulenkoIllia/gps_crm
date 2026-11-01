import {
  activityListQuerySchema,
  duplicatesQuerySchema,
  subscriberCodeCheckQuerySchema,
  subscriberCodeInputSchema,
  subscriberCountQuerySchema,
  subscriberCreateSchema,
  subscriberListQuerySchema,
  subscriberTariffInputSchema,
  subscriberUpdateSchema,
  type ActivityList,
  type DuplicateList,
  type ManagerList,
  type SubscriberCard,
  type SubscriberCodeCheck,
  type SubscriberCount,
  type SubscriberList,
} from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { activityContext, can, recordScope } from "../../core/access/access.js";
import { API_PREFIX } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { archiveSubscriber, deleteSubscriber, restoreRecord, type PackageDeps } from "./archive.service.js";
import { changing, creating, idOf } from "../../core/http/route-helpers.js";
import {
  changeSubscriberCode,
  changeSubscriberTariff,
  createSubscriber,
  updateSubscriber,
} from "./subscribers.service.js";
import {
  checkCode,
  countClients,
  findRecordBatchId,
  listClientActivity,
  listClients,
  listManagerOptions,
  lookUpDuplicates,
  readCard,
} from "./subscribers.read.service.js";

const PATH = `${API_PREFIX}/subscribers`;

export function registerSubscriberRoutes(app: FastifyInstance, deps: PackageDeps): void {
  const read = { config: { access: can("subscribers.read") } };
  const write = { config: { access: can("subscribers.write") } };
  const changeCode = { config: { access: can("subscribers.code.change") } };
  const archive = { config: { access: can("records.archive") } };

  app.get(PATH, read, (request): Promise<SubscriberList> => {
    return listClients(deps, parseInput(subscriberListQuerySchema, request.query), recordScope(request));
  });

  app.get(`${PATH}/count`, read, (request): Promise<SubscriberCount> => {
    return countClients(deps, parseInput(subscriberCountQuerySchema, request.query), recordScope(request));
  });

  // The choice of a manager in a form: open to whoever works with clients, unlike the list of users
  app.get(`${PATH}/managers`, read, (): Promise<ManagerList> => listManagerOptions(deps));

  app.get(`${PATH}/code-check`, changeCode, (request): Promise<SubscriberCodeCheck> => {
    const { code, excludeId } = parseInput(subscriberCodeCheckQuerySchema, request.query);
    return checkCode(deps, code, excludeId, recordScope(request));
  });

  app.get(`${PATH}/duplicates`, write, (request): Promise<DuplicateList> => {
    return lookUpDuplicates(deps, parseInput(duplicatesQuerySchema, request.query), recordScope(request));
  });

  app.get(`${PATH}/:id`, read, (request): Promise<SubscriberCard> => {
    return readCard(deps, idOf(request), recordScope(request));
  });

  app.post(
    PATH,
    write,
    creating((request) => {
      const input = parseInput(subscriberCreateSchema, request.body);
      return createSubscriber(deps, activityContext(request), recordScope(request), input);
    }),
  );

  app.patch(
    `${PATH}/:id`,
    write,
    changing((request, id) => {
      const input = parseInput(subscriberUpdateSchema, request.body);
      return updateSubscriber(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/tariff`,
    write,
    changing((request, id) => {
      const input = parseInput(subscriberTariffInputSchema, request.body);
      return changeSubscriberTariff(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.patch(
    `${PATH}/:id/code`,
    changeCode,
    changing((request, id) => {
      const input = parseInput(subscriberCodeInputSchema, request.body);
      return changeSubscriberCode(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/archive`,
    archive,
    changing((request, id) => archiveSubscriber(deps, activityContext(request), recordScope(request), id)),
  );

  app.post(
    `${PATH}/:id/restore`,
    archive,
    changing(async (request, id) => {
      const scope = recordScope(request);
      const batchId = await findRecordBatchId(deps, "subscriber", id, scope);
      await restoreRecord(deps, activityContext(request), scope, batchId);
    }),
  );

  app.delete(
    `${PATH}/:id`,
    { config: { access: can("records.delete") } },
    changing((request, id) => deleteSubscriber(deps, activityContext(request), recordScope(request), id)),
  );

  app.get(`${PATH}/:id/activity`, { config: { access: can("activity.read") } }, (request): Promise<ActivityList> => {
    const query = parseInput(activityListQuerySchema, request.query);
    return listClientActivity(deps, idOf(request), query, recordScope(request));
  });
}
