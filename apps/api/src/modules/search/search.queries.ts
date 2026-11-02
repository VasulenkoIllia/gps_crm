import {
  normalizeName,
  reverseDigits,
  SEARCH_GROUP_SIZE,
  SEARCH_MIN_DIGITS,
  SEARCH_MIN_NAME,
  type ContactHit,
  type SearchGroup,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { escapeLike } from "../../core/db/like.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { subscriberWhere } from "../subscribers/index.js";

const NOTHING: Prisma.ContactWhereInput = { id: { in: [] } };

// For the rest of the transaction only: the pool's connection goes back with its own limit
export async function limitStatementTime(tx: DbOrTx, ms: number): Promise<void> {
  await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`;
}

// П1 and П2: a phone by how it ends, as a person reads it off a call; a name by any part of it
function contactMatch(text: string, isNumber: boolean): Prisma.ContactWhereInput {
  if (isNumber) {
    const digits = text.replace(/\D/g, "");
    if (digits.length < SEARCH_MIN_DIGITS) return NOTHING;
    const reversed = reverseDigits(digits);
    return { OR: [{ phoneRev: { startsWith: reversed } }, { phone2Rev: { startsWith: reversed } }] };
  }
  const name = normalizeName(text);
  return name.length >= SEARCH_MIN_NAME ? { fullNameNorm: { contains: escapeLike(name) } } : NOTHING;
}

const CONTACT_HIT = {
  id: true,
  fullName: true,
  phone: true,
  archivedAt: true,
  subscriber: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ContactSelect;

// Contacts have no list of their own, so this group is read here. A contact of an archived client is in the archive with
// it. The live ones first and on their own: the indexes hold only them, and the archive is read when they fall short.
export async function searchContacts(
  db: DbOrTx,
  text: string,
  isNumber: boolean,
  scope: RecordScope,
  withArchive: boolean,
): Promise<SearchGroup<ContactHit>> {
  const read = (isArchived: boolean, take: number) =>
    db.contact.findMany({
      where: {
        AND: [contactMatch(text, isNumber), { subscriber: subscriberWhere(scope) }],
        archivedAt: isArchived ? { not: null } : null,
      },
      orderBy: [{ fullNameNorm: "asc" }, { id: "asc" }],
      take,
      select: CONTACT_HIT,
    });
  const wanted = SEARCH_GROUP_SIZE + 1;
  const live = await read(false, wanted);
  const rows = withArchive && live.length < wanted ? [...live, ...(await read(true, wanted - live.length))] : live;
  return {
    items: rows.slice(0, SEARCH_GROUP_SIZE).map(({ subscriber, archivedAt, ...row }) => ({
      ...row,
      subscriberId: subscriber.id,
      subscriberCode: Number(subscriber.code),
      subscriberName: subscriber.name,
      isArchived: archivedAt !== null,
    })),
    hasMore: rows.length > SEARCH_GROUP_SIZE,
  };
}
