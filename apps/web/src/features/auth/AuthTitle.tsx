import type { ReactNode } from "react";
import { usePageTitle } from "../../ui";

export function AuthTitle({ title, hint }: { title: string; hint?: ReactNode }) {
  usePageTitle(title);
  return (
    <>
      <h1 className="auth-title">{title}</h1>
      {hint && <p className="auth-hint">{hint}</p>}
    </>
  );
}
