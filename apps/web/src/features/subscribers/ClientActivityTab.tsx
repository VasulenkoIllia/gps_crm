import { useCallback } from "react";
import { ACTIVITY_KEY } from "../activity/activity.api";
import { RecordActivityTab } from "../activity/RecordActivityTab";
import { fetchClientActivity } from "./subscribers.api";

// D53: everything that happened to this client and what hangs off it
export function ClientActivityTab({ subscriberId }: { subscriberId: string }) {
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchClientActivity(subscriberId, cursor, signal),
    [subscriberId],
  );
  return <RecordActivityTab queryKey={[...ACTIVITY_KEY, "client", subscriberId]} fetchPage={fetchPage} />;
}
