import { useEffect } from "react";

const APP_TITLE = "GPS Облік";

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | ${APP_TITLE}`;
  }, [title]);
}
