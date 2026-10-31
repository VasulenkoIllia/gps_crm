import { useEffect, useRef, type ReactNode } from "react";
import { usePageTitle } from "./usePageTitle";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageTitle(title);

  // A route change replaces the page silently: focus on the heading tells a screen reader and sets the Tab order
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);

  return (
    <header className="page-title">
      <div className="page-title-text">
        <h1 ref={heading} tabIndex={-1} className="page-title-heading">
          {title}
        </h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-title-extra">{actions}</div>}
    </header>
  );
}
