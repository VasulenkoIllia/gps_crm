import { Skeleton } from "antd";
import { Navigate, Outlet, useLocation } from "react-router";
import { loginPath } from "../lib/login-path";
import { useCurrentUser, usePermissions } from "../lib/session";
import { LoadError } from "../ui";

const SETUP_PATH = "/setup-2fa";

// The server guards the data; this only spares a person a screen that would refuse them. isSetupPage lets in a person
// who has yet to set up the mandatory second factor (K2).
export function RequireSession({ isSetupPage = false }: { isSetupPage?: boolean }) {
  const { pathname, search } = useLocation();
  const user = useCurrentUser();
  const isReady = Boolean(user.data?.twoFactorEnabled);
  const permissions = usePermissions({ isEnabled: isReady && !isSetupPage });

  // Only with nothing to show: a failed background refresh must not take down the page, its open forms and the recovery
  // codes that are shown once
  if (user.data === undefined) {
    if (user.error) return <LoadError error={user.error} onRetry={() => void user.refetch()} />;
    return <Skeleton active />;
  }
  if (!user.data) return <Navigate to={loginPath(`${pathname}${search}`)} replace />;
  if (isSetupPage) return <Outlet />;
  if (!isReady) return <Navigate to={SETUP_PATH} replace />;
  if (permissions.data === undefined) {
    if (permissions.error) return <LoadError error={permissions.error} onRetry={() => void permissions.refetch()} />;
    return <Skeleton active />;
  }
  return <Outlet />;
}
