import { Skeleton } from "antd";
import { Suspense } from "react";
import { Outlet } from "react-router";
import { BrandMark, ErrorBoundary } from "../../ui";

export function AuthLayout() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
        </div>
        <ErrorBoundary>
          <Suspense fallback={<Skeleton active />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </div>
    </main>
  );
}
