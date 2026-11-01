import type {
  AddonList,
  CostSubjectType,
  PriceEntry,
  ReferenceListQuery,
  ServerList,
  SimpleReferenceKind,
  SimpleReferenceList,
  SimPlanList,
  TariffList,
} from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate } from "../../core/db/dates.js";
import { SIMPLE_ROW, simpleTable } from "./references.repository.js";

const LIST_ROW = { id: true, name: true, isActive: true, version: true } as const;

function statusWhere(query: ReferenceListQuery) {
  return query.status ? { isActive: query.status === "active" } : {};
}

// Prisma's own cursor walks whatever order the list has, so each list keeps its natural one (references.md §5)
function pageArgs(query: ReferenceListQuery) {
  return { take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) };
}

function toPage<T extends { id: string }>(rows: T[], limit: number) {
  const page = rows.slice(0, limit);
  return { page, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

function toEntry(row: { id: string; amountKop: bigint; validFrom: Date }): PriceEntry {
  return { id: row.id, amountKop: Number(row.amountKop), validFrom: fromDbDate(row.validFrom) };
}

async function readCosts(
  db: DbOrTx,
  subjectType: CostSubjectType,
  subjectIds: string[],
): Promise<Map<string, PriceEntry[]>> {
  const rows = await db.costPrice.findMany({
    where: { subjectType, subjectId: { in: subjectIds } },
    orderBy: { validFrom: "asc" },
    select: { id: true, subjectId: true, costKop: true, validFrom: true },
  });
  const costs = new Map<string, PriceEntry[]>();
  for (const row of rows) {
    const entry = toEntry({ id: row.id, amountKop: row.costKop, validFrom: row.validFrom });
    costs.set(row.subjectId, [...(costs.get(row.subjectId) ?? []), entry]);
  }
  return costs;
}

// Costs are asked for only on behalf of a person who may see them: a null keeps them out of the answer altogether
function costsOf(
  db: DbOrTx,
  subjectType: CostSubjectType,
  subjectIds: string[],
  canReadCost: boolean,
): Promise<Map<string, PriceEntry[]>> | null {
  return canReadCost ? readCosts(db, subjectType, subjectIds) : null;
}

export async function listSimple(
  db: DbOrTx,
  kind: SimpleReferenceKind,
  query: ReferenceListQuery,
): Promise<SimpleReferenceList> {
  const rows = await simpleTable(db, kind).findMany({
    where: statusWhere(query),
    orderBy: [{ sortOrder: "asc" }, { nameNorm: "asc" }, { id: "asc" }],
    select: SIMPLE_ROW,
    ...pageArgs(query),
  });
  const { page, nextCursor } = toPage(rows, query.limit);
  return { items: page, nextCursor };
}

export async function listServers(db: DbOrTx, query: ReferenceListQuery, canReadCost: boolean): Promise<ServerList> {
  const rows = await db.monitoringServer.findMany({
    where: statusWhere(query),
    orderBy: [{ programId: "asc" }, { nameNorm: "asc" }, { id: "asc" }],
    select: { ...LIST_ROW, url: true, programId: true, program: { select: { name: true } } },
    ...pageArgs(query),
  });
  const { page, nextCursor } = toPage(rows, query.limit);
  const costs = await costsOf(
    db,
    "server",
    page.map(({ id }) => id),
    canReadCost,
  );
  return {
    items: page.map(({ program, ...row }) => ({
      ...row,
      programName: program.name,
      costs: costs ? (costs.get(row.id) ?? []) : null,
    })),
    nextCursor,
  };
}

export async function listTariffs(db: DbOrTx, query: ReferenceListQuery): Promise<TariffList> {
  const rows = await db.tariff.findMany({
    where: statusWhere(query),
    orderBy: [{ programId: "asc" }, { serverId: "asc" }, { nameNorm: "asc" }, { billingModel: "asc" }, { id: "asc" }],
    select: {
      ...LIST_ROW,
      programId: true,
      serverId: true,
      billingModel: true,
      priceKop: true,
      selectedAt: true,
      program: { select: { name: true } },
      server: { select: { name: true } },
      _count: { select: { subscribers: { where: { archivedAt: null } } } },
    },
    ...pageArgs(query),
  });
  const { page, nextCursor } = toPage(rows, query.limit);
  return {
    items: page.map(({ program, server, selectedAt, priceKop, _count, ...row }) => ({
      ...row,
      priceKop: Number(priceKop),
      isSelected: selectedAt !== null,
      programName: program.name,
      serverName: server.name,
      clientCount: _count.subscribers,
    })),
    nextCursor,
  };
}

export async function listAddons(db: DbOrTx, query: ReferenceListQuery, canReadCost: boolean): Promise<AddonList> {
  const rows = await db.addon.findMany({
    where: statusWhere(query),
    orderBy: [{ nameNorm: "asc" }, { id: "asc" }],
    select: {
      ...LIST_ROW,
      programs: { select: { program: { select: { id: true, name: true } } } },
      prices: { orderBy: { validFrom: "asc" }, select: { id: true, priceKop: true, validFrom: true } },
    },
    ...pageArgs(query),
  });
  const { page, nextCursor } = toPage(rows, query.limit);
  const costs = await costsOf(
    db,
    "addon",
    page.map(({ id }) => id),
    canReadCost,
  );
  return {
    items: page.map(({ programs, prices, ...row }) => ({
      ...row,
      programs: programs.map(({ program }) => program),
      prices: prices.map(({ priceKop, ...price }) => toEntry({ ...price, amountKop: priceKop })),
      costs: costs ? (costs.get(row.id) ?? []) : null,
    })),
    nextCursor,
  };
}

export async function listSimPlans(db: DbOrTx, query: ReferenceListQuery, canReadCost: boolean): Promise<SimPlanList> {
  const rows = await db.simPlan.findMany({
    where: statusWhere(query),
    orderBy: [{ operatorId: "asc" }, { sortOrder: "asc" }, { nameNorm: "asc" }, { id: "asc" }],
    select: { ...SIMPLE_ROW, operatorId: true, operator: { select: { name: true } } },
    ...pageArgs(query),
  });
  const { page, nextCursor } = toPage(rows, query.limit);
  const costs = await costsOf(
    db,
    "sim_plan",
    page.map(({ id }) => id),
    canReadCost,
  );
  return {
    items: page.map(({ operator, ...row }) => ({
      ...row,
      operatorName: operator.name,
      costs: costs ? (costs.get(row.id) ?? []) : null,
    })),
    nextCursor,
  };
}
