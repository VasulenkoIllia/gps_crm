import { contactCreateSchema, contactUpdateSchema, type ContactList } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { activityContext, can, recordScope } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { archiveContact, restoreRecord } from "./archive.service.js";
import { createContact, deleteContact, listContacts, makeContactPrimary, updateContact } from "./contacts.service.js";
import { changing, creating, idOf } from "./route-helpers.js";
import { findRecordBatchId } from "./subscribers.read.service.js";

const OF_CLIENT = `${API_PREFIX}/subscribers/:id/contacts`;
const PATH = `${API_PREFIX}/contacts`;

export function registerContactRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("subscribers.read") } };
  const write = { config: { access: can("subscribers.write") } };
  const archive = { config: { access: can("records.archive") } };

  app.get(OF_CLIENT, read, (request): Promise<ContactList> => {
    return listContacts(deps, recordScope(request), idOf(request));
  });

  app.post(
    OF_CLIENT,
    write,
    creating((request) => {
      const input = parseInput(contactCreateSchema, request.body);
      return createContact(deps, activityContext(request), recordScope(request), idOf(request), input);
    }),
  );

  app.patch(
    `${PATH}/:id`,
    write,
    changing((request, id) => {
      const input = parseInput(contactUpdateSchema, request.body);
      return updateContact(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/make-primary`,
    write,
    changing((request, id) => makeContactPrimary(deps, activityContext(request), recordScope(request), id)),
  );

  app.post(
    `${PATH}/:id/archive`,
    archive,
    changing((request, id) => archiveContact(deps, activityContext(request), recordScope(request), id)),
  );

  app.post(
    `${PATH}/:id/restore`,
    archive,
    changing(async (request, id) => {
      const scope = recordScope(request);
      const batchId = await findRecordBatchId(deps, "contact", id, scope);
      await restoreRecord(deps, activityContext(request), scope, batchId);
    }),
  );

  app.delete(
    `${PATH}/:id`,
    { config: { access: can("records.delete") } },
    changing((request, id) => deleteContact(deps, activityContext(request), recordScope(request), id)),
  );
}
