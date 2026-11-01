import type { RoleKey, UserList, UserListQuery } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";

// Keyset on id: uuidv7 orders by creation, so a page is stable while people are invited
export async function listUsers(db: DbOrTx, query: UserListQuery): Promise<UserList> {
  const rows = await db.user.findMany({
    orderBy: { id: "asc" },
    take: query.limit + 1,
    ...(query.cursor ? { where: { id: { gt: query.cursor } } } : {}),
    select: {
      id: true,
      email: true,
      fullName: true,
      status: true,
      lastLoginAt: true,
      role: { select: { key: true } },
      twoFactorCredential: { select: { confirmedAt: true } },
    },
  });
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      roleKey: row.role.key as RoleKey,
      status: row.status,
      twoFactorEnabled: Boolean(row.twoFactorCredential?.confirmedAt),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
