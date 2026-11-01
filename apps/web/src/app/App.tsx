import { lazy, type ComponentType, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { AuthLayout } from "../features/auth/AuthLayout";
import { AppShell } from "./AppShell";
import { NAV_ITEMS } from "./nav";
import { NotFoundPage } from "./NotFoundPage";
import { PlaceholderPage } from "./PlaceholderPage";
import { RequireSession } from "./RequireSession";

function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const LoginPage = lazyPage(() => import("../features/auth/LoginPage"), "LoginPage");
const ForgotPasswordPage = lazyPage(() => import("../features/auth/ForgotPasswordPage"), "ForgotPasswordPage");
const ResetPasswordPage = lazyPage(() => import("../features/auth/ResetPasswordPage"), "ResetPasswordPage");
const InvitePage = lazyPage(() => import("../features/auth/InvitePage"), "InvitePage");
const TwoFactorSetupPage = lazyPage(() => import("../features/auth/TwoFactorSetupPage"), "TwoFactorSetupPage");
const ProfilePage = lazyPage(() => import("../features/profile/ProfilePage"), "ProfilePage");
const UsersPage = lazyPage(() => import("../features/users/UsersPage"), "UsersPage");
const ReferencesPage = lazyPage(() => import("../features/references/ReferencesPage"), "ReferencesPage");
const SubscribersPage = lazyPage(() => import("../features/subscribers/SubscribersPage"), "SubscribersPage");
const SubscriberPage = lazyPage(() => import("../features/subscribers/SubscriberPage"), "SubscriberPage");
const ContractsPage = lazyPage(() => import("../features/contracts/ContractsPage"), "ContractsPage");
const IdSeriesPage = lazyPage(() => import("../features/id-series/IdSeriesPage"), "IdSeriesPage");
const ActivityPage = lazyPage(() => import("../features/activity/ActivityPage"), "ActivityPage");
const ArchivePage = lazyPage(() => import("../features/activity/ArchivePage"), "ArchivePage");
const SystemPage = lazyPage(() => import("../features/system/SystemPage"), "SystemPage");
const ShowcasePage = lazyPage(() => import("../features/ui-showcase/ShowcasePage"), "ShowcasePage");

const BUILT_PAGES: Record<string, ReactNode> = {
  "/subscribers": <SubscribersPage />,
  "/contracts": <ContractsPage />,
  "/references": <ReferencesPage />,
  "/id-series": <IdSeriesPage />,
  "/users": <UsersPage />,
  "/activity": <ActivityPage />,
  "/archive": <ArchivePage />,
  "/system": <SystemPage />,
};

export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invite" element={<InvitePage />} />
      </Route>
      <Route element={<AuthLayout />}>
        <Route element={<RequireSession isSetupPage />}>
          <Route path="/setup-2fa" element={<TwoFactorSetupPage />} />
        </Route>
      </Route>
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          {NAV_ITEMS.map((item) => (
            <Route
              key={item.path}
              path={item.path}
              element={BUILT_PAGES[item.path] ?? <PlaceholderPage title={item.label} />}
            />
          ))}
          <Route path="/subscribers/:id" element={<SubscriberPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/ui" element={<ShowcasePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
