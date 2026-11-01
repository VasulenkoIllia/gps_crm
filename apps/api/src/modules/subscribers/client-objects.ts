import type { DbOrTx } from "../../core/db/client.js";
import type { SelectedTariff } from "../references/index.js";

export interface ArchivedObject {
  id: string;
  label: string;
}

// What the client needs from its objects. The objects hang off a client and not the other way round, so this module names
// the need and `objects` fills it, as a restorer of the archive (app.ts joins them).
export interface ClientObjects {
  // objects.md П18, D70: the mirror of an object without its own tariff keeps up with the client
  followClientTariff(tx: DbOrTx, subscriberId: string, tariff: SelectedTariff, actorId: string | null): Promise<void>;
  archiveWithClient(
    tx: DbOrTx,
    subscriberId: string,
    batchId: string,
    actorId: string | null,
  ): Promise<ArchivedObject[]>;
  restoreWithClient(tx: DbOrTx, batchId: string): Promise<(ArchivedObject & { subscriberId: string })[]>;
}
