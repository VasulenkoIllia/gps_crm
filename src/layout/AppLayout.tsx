import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Button, Drawer, Grid, Layout, Menu, Popconfirm, Select, Tag, Tooltip } from "antd";
import {
  AppstoreOutlined, CarOutlined, DashboardOutlined, HddOutlined, MenuOutlined, NotificationOutlined,
  ReloadOutlined, SafetyOutlined, TeamOutlined, WalletOutlined,
} from "@ant-design/icons";
import { useStore } from "../store/DemoStore";
import { ROLE_LABELS, type Permission } from "../domain/permissions";
import { USERS } from "../data/reference";
import type { RoleId } from "../domain/types";

const ROLE_SHORT: Record<RoleId, string> = { admin: "Адмін", manager: "Менеджер", tech: "Техспеціаліст" };

const NAV: { path: string; label: string; icon: ReactNode; perm?: Permission }[] = [
  { path: "/", label: "Дашборд", icon: <DashboardOutlined /> },
  { path: "/subscribers", label: "Абоненти", icon: <TeamOutlined /> },
  { path: "/objects", label: "Об'єкти", icon: <CarOutlined /> },
  { path: "/payments", label: "Оплати та борги", icon: <WalletOutlined />, perm: "finance.view" },
  { path: "/equipment", label: "Обладнання та SIM", icon: <HddOutlined /> },
  { path: "/mailings", label: "Розсилки", icon: <NotificationOutlined />, perm: "mailings.send" },
  { path: "/references", label: "Тарифи та довідники", icon: <AppstoreOutlined /> },
  { path: "/roles", label: "Ролі та доступи", icon: <SafetyOutlined /> },
];

export default function AppLayout() {
  const { ui, setRole, can, reset } = useStore();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const selected = NAV.filter((n) => n.path !== "/" && location.pathname.startsWith(n.path)).map((n) => n.path);
  const menu = (
    <Menu
      mode="inline"
      selectedKeys={selected.length ? selected : location.pathname === "/" ? ["/"] : []}
      onClick={() => setDrawerOpen(false)}
      items={NAV.filter((n) => !n.perm || can(n.perm)).map((n) => ({
        key: n.path,
        icon: n.icon,
        label: <Link to={n.path}>{n.label}</Link>,
      }))}
      style={{ borderInlineEnd: 0 }}
    />
  );

  const roleOptions = (Object.keys(ROLE_LABELS) as RoleId[]).map((r) => ({
    value: r,
    label: isMobile ? ROLE_SHORT[r] : `${ROLE_LABELS[r]} · ${USERS.find((u) => u.role === r)?.name ?? ""}`,
  }));

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Layout.Sider width={236} theme="light" className="app-sider">
          <Brand />
          {menu}
        </Layout.Sider>
      )}
      <Drawer open={isMobile && drawerOpen} onClose={() => setDrawerOpen(false)} placement="left" size={260} title={<Brand compact />}>
        {menu}
      </Drawer>
      <Layout>
        <Layout.Header className="app-header">
          {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="Меню" />}
          {isMobile && screens.sm && <Brand compact />}
          <div className="app-header-controls" style={isMobile ? { gap: 8 } : undefined}>
            <Tooltip title="Перемикайте роль, щоб побачити систему очима менеджера або техспеціаліста">
              <Select
                value={ui.role}
                onChange={setRole}
                options={roleOptions}
                style={{ width: isMobile ? 130 : 290 }}
                popupMatchSelectWidth={false}
              />
            </Tooltip>
            <Popconfirm
              title="Скинути демо-дані?"
              description="Усі внесені зміни буде втрачено."
              okText="Скинути"
              cancelText="Скасувати"
              onConfirm={reset}
            >
              <Button icon={<ReloadOutlined />} aria-label="Скинути демо-дані">
                {isMobile ? null : "Скинути"}
              </Button>
            </Popconfirm>
          </div>
        </Layout.Header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className={compact ? "brand brand-compact" : "brand"}>
      <span className="brand-mark">GPS</span>
      <span className="brand-name">Облік абонентів</span>
      {!compact && <Tag color="orange" style={{ marginInlineStart: "auto" }}>демо</Tag>}
    </Link>
  );
}
