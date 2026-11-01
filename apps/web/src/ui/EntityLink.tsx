import type { ReactNode } from "react";
import { Link } from "react-router";

interface EntityLinkProps {
  to: string;
  children: ReactNode;
  // From an open form: going there on the same page would lose what is typed
  isNewTab?: boolean;
}

export function EntityLink({ to, children, isNewTab }: EntityLinkProps) {
  return (
    <Link
      className="table-link"
      to={to}
      target={isNewTab ? "_blank" : undefined}
      rel={isNewTab ? "noreferrer" : undefined}
    >
      {children}
    </Link>
  );
}
