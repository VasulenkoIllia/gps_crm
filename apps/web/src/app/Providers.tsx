import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, Grid } from "antd";
import ukUA from "antd/locale/uk_UA";
import { useMemo, type ReactNode } from "react";
import { BrowserRouter } from "react-router";
import "../lib/dayjs";
import { queryClient } from "../lib/query-client";
import { buildTheme } from "../ui";

export function Providers({ children }: { children: ReactNode }) {
  const screens = Grid.useBreakpoint();
  const isPhone = screens.md === false;
  const theme = useMemo(() => buildTheme(isPhone), [isPhone]);

  return (
    <ConfigProvider locale={ukUA} theme={theme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>{children}</BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
