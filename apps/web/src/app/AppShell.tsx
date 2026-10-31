import { MenuOutlined } from "@ant-design/icons";
import { Button, Drawer, Grid, Layout, Menu, Skeleton } from "antd";
import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ErrorBoundary } from "../ui";
import { findActiveKeys, NAV_ITEMS } from "./nav";

const SIDER_WIDTH_PX = 236;
const DRAWER_WIDTH_PX = 300;
const DRAWER_BODY_PADDING_PX = 8;
const MAIN_ID = "main";

const MENU_ITEMS = NAV_ITEMS.map((item) => ({
  key: item.path,
  icon: item.icon,
  label: (
    <NavLink to={item.path} end={item.path === "/"}>
      {item.label}
    </NavLink>
  ),
}));

function AppMenu({ onSelect }: { onSelect?: () => void }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Основне меню">
      <Menu
        mode="inline"
        selectedKeys={findActiveKeys(pathname)}
        onClick={onSelect}
        items={MENU_ITEMS}
        style={{ borderInlineEnd: 0 }}
      />
    </nav>
  );
}

// Unmounts on a wide screen, so an open drawer does not come back when the screen narrows again. Any navigation closes
// it, not only the menu: the state is reset during render, because a later Back must not reopen it.
function MobileNav() {
  const { pathname } = useLocation();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  if (openedOn !== null && openedOn !== pathname) setOpenedOn(null);
  const isOpen = openedOn === pathname;
  const close = () => setOpenedOn(null);

  return (
    <>
      <Button
        type="text"
        icon={<MenuOutlined />}
        onClick={() => setOpenedOn(pathname)}
        aria-label="Меню"
        aria-expanded={isOpen}
      />
      <Brand isCompact />
      <Drawer
        open={isOpen}
        onClose={close}
        placement="left"
        size={DRAWER_WIDTH_PX}
        styles={{ body: { padding: DRAWER_BODY_PADDING_PX } }}
        title={<Brand isCompact />}
      >
        <AppMenu onSelect={close} />
      </Drawer>
    </>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <Layout className="app-root">
      <a href={`#${MAIN_ID}`} className="skip-link">
        Перейти до вмісту
      </a>
      {!isMobile && (
        <Layout.Sider width={SIDER_WIDTH_PX} theme="light" className="app-sider">
          <Brand />
          <AppMenu />
        </Layout.Sider>
      )}
      <Layout>
        <Layout.Header className="app-header">{isMobile && <MobileNav />}</Layout.Header>
        <Layout.Content id={MAIN_ID} className="app-content">
          {/* The key resets the error when the user leaves the broken page, and the menu keeps working around it */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<Skeleton active />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function Brand({ isCompact = false }: { isCompact?: boolean }) {
  return (
    <Link to="/" className={isCompact ? "brand brand-compact" : "brand"}>
      <span className="brand-mark">GPS</span>
      <span className="brand-name">Облік</span>
    </Link>
  );
}
