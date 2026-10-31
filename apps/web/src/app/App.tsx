import { lazy } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "./AppShell";
import { NAV_ITEMS } from "./nav";
import { NotFoundPage } from "./NotFoundPage";
import { PlaceholderPage } from "./PlaceholderPage";

const ShowcasePage = lazy(() =>
  import("../features/ui-showcase/ShowcasePage").then((module) => ({ default: module.ShowcasePage })),
);

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {NAV_ITEMS.map((item) => (
          <Route key={item.path} path={item.path} element={<PlaceholderPage title={item.label} />} />
        ))}
        <Route path="/ui" element={<ShowcasePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
