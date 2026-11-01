import { idParamsSchema } from "@gps_crm/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { parseInput } from "./validate.js";

const CREATED = 201;
const NO_CONTENT = 204;

// A create route: what the service returns goes out as 201
export function creating<T>(handler: (request: FastifyRequest) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => reply.code(CREATED).send(await handler(request));
}

// A change route on a record: the id comes parsed, and the answer has no body
export function changing(handler: (request: FastifyRequest, id: string) => Promise<void>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await handler(request, parseInput(idParamsSchema, request.params).id);
    return reply.code(NO_CONTENT).send();
  };
}

export function idOf(request: FastifyRequest): string {
  return parseInput(idParamsSchema, request.params).id;
}
