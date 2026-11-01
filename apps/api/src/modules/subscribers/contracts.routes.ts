import { basename } from "node:path";
import {
  contractCreateSchema,
  contractFileQuerySchema,
  contractListQuerySchema,
  contractNumberCheckQuerySchema,
  contractUpdateSchema,
  type ContractList,
  type ContractNumberCheck,
} from "@gps_crm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { activityContext, can, recordScope } from "../../core/access/access.js";
import { API_PREFIX, UPLOAD_RATE_LIMIT, type AppDeps } from "../../core/deps.js";
import { contentDisposition } from "../../core/http/content-disposition.js";
import { parseInput } from "../../core/http/validate.js";
import { archiveContract, restoreRecord } from "./archive.service.js";
import {
  checkContractNumber,
  createContract,
  fileRefused,
  listContracts,
  listSubscriberContracts,
  readContractFile,
  updateContract,
  uploadContractFile,
  type ContractUpload,
} from "./contracts.service.js";
import { changing, creating, idOf } from "./route-helpers.js";
import { findRecordBatchId } from "./subscribers.read.service.js";

const OF_CLIENT = `${API_PREFIX}/subscribers/:id/contracts`;
const PATH = `${API_PREFIX}/contracts`;
const FILE_NAME_MAX_LENGTH = 255;
const MULTIPART_ERROR_PREFIX = "FST_";

// Whatever goes wrong with a form of a file (too big, not a form at all), a person reads the one sentence of the module doc
function asFileRefusal(error: unknown): Error {
  const isMultipartError =
    error instanceof Error && "code" in error && String(error.code).startsWith(MULTIPART_ERROR_PREFIX);
  return isMultipartError ? fileRefused() : (error as Error);
}

async function readUpload(request: FastifyRequest): Promise<ContractUpload> {
  try {
    const part = await request.file();
    if (!part) throw fileRefused();
    const content = await part.toBuffer();
    // A browser may send a whole path, and it reaches a header and the journal
    return { fileName: basename(part.filename).slice(-FILE_NAME_MAX_LENGTH), content };
  } catch (error) {
    throw asFileRefusal(error);
  }
}

export function registerContractRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("subscribers.read") } };
  const write = { config: { access: can("subscribers.write") } };
  const archive = { config: { access: can("records.archive") } };

  app.get(PATH, read, (request): Promise<ContractList> => {
    return listContracts(deps, parseInput(contractListQuerySchema, request.query), recordScope(request));
  });

  app.get(`${PATH}/number-check`, write, (request): Promise<ContractNumberCheck> => {
    return checkContractNumber(deps, recordScope(request), parseInput(contractNumberCheckQuerySchema, request.query));
  });

  app.get(OF_CLIENT, read, (request): Promise<ContractList> => {
    return listSubscriberContracts(deps, recordScope(request), idOf(request));
  });

  app.post(
    OF_CLIENT,
    write,
    creating((request) => {
      const input = parseInput(contractCreateSchema, request.body);
      return createContract(deps, activityContext(request), recordScope(request), idOf(request), input);
    }),
  );

  app.patch(
    `${PATH}/:id`,
    write,
    changing((request, id) => {
      const input = parseInput(contractUpdateSchema, request.body);
      return updateContract(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/file`,
    { config: { ...write.config, rateLimit: UPLOAD_RATE_LIMIT } },
    changing(async (request, id) => {
      const upload = await readUpload(request);
      await uploadContractFile(deps, activityContext(request), recordScope(request), id, upload);
    }),
  );

  app.get(`${PATH}/:id/file`, read, async (request, reply: FastifyReply) => {
    const { disposition } = parseInput(contractFileQuerySchema, request.query);
    const scope = recordScope(request);
    const file = await readContractFile(deps, activityContext(request), scope, idOf(request), disposition);
    return reply
      .header("content-type", file.mime)
      .header("content-disposition", contentDisposition(disposition, file.name))
      .header("cache-control", "private, no-store")
      .send(file.content);
  });

  app.post(
    `${PATH}/:id/archive`,
    archive,
    changing((request, id) => archiveContract(deps, activityContext(request), recordScope(request), id)),
  );

  app.post(
    `${PATH}/:id/restore`,
    archive,
    changing(async (request, id) => {
      const scope = recordScope(request);
      const batchId = await findRecordBatchId(deps, "contract", id, scope);
      await restoreRecord(deps, activityContext(request), scope, batchId);
    }),
  );
}
