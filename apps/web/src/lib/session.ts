import { currentUserSchema, permissionListSchema, type CurrentUser, type PermissionKey } from "@gps_crm/shared";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, apiSend } from "./api";
import { LOGIN_PATH } from "./login-path";
import { isSessionLost } from "./query-client";

export const CURRENT_USER_KEY = ["me"];
const PERMISSIONS_KEY = ["me", "permissions"];

// A sign-in page is expected to find nobody signed in, so here a 401 is an answer, not a failure
async function fetchCurrentUser(signal: AbortSignal): Promise<CurrentUser | null> {
  try {
    return await apiGet("/me", currentUserSchema, signal);
  } catch (error) {
    if (isSessionLost(error)) return null;
    throw error;
  }
}

export function useCurrentUser(): UseQueryResult<CurrentUser | null> {
  return useQuery({ queryKey: CURRENT_USER_KEY, queryFn: ({ signal }) => fetchCurrentUser(signal) });
}

async function fetchPermissions(signal: AbortSignal): Promise<Set<PermissionKey>> {
  const { permissions } = await apiGet("/me/permissions", permissionListSchema, signal);
  return new Set(permissions.map((permission) => permission.key));
}

export function usePermissions(options: { isEnabled?: boolean } = {}): UseQueryResult<Set<PermissionKey>> {
  return useQuery({
    queryKey: PERMISSIONS_KEY,
    queryFn: ({ signal }) => fetchPermissions(signal),
    enabled: options.isEnabled ?? true,
  });
}

// Hides what the server would refuse anyway: the check that counts is on the route
export function useCan(key: PermissionKey): boolean {
  return usePermissions().data?.has(key) ?? false;
}

// A full page load leaves nothing of the previous person in memory. queryClient.clear() would do worse here: a screen
// still on show fetches its query again, gets a 401 and sends the person to sign in with a `next` back to that screen.
export function leaveForLogin(): void {
  window.location.replace(LOGIN_PATH);
}

export async function logout(): Promise<void> {
  await apiSend("POST", "/auth/logout");
  leaveForLogin();
}
