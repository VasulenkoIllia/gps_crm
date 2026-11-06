import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarsOutlined,
  CarOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HddOutlined,
  HistoryOutlined,
  InboxOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { PermissionKey } from "@gps_crm/shared";
import type { ReactNode } from "react";

export interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  // Without it the item is for everyone who signed in
  permission?: PermissionKey;
  // The heading the item stands under; none for the home page on top
  group?: NavGroup;
}

type NavGroup = "Робота" | "Контроль" | "Налаштування";

// The same twelve items in groups: daily work first, then what checks it, then what sets it up (manual test 05.11.2026)
export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Головна", icon: <DashboardOutlined /> },
  { path: "/subscribers", label: "Клієнти", icon: <TeamOutlined />, group: "Робота" },
  { path: "/objects", label: "Об'єкти", icon: <CarOutlined />, permission: "objects.read", group: "Робота" },
  {
    path: "/equipment",
    label: "Обладнання та SIM",
    icon: <HddOutlined />,
    permission: "equipment.read",
    group: "Робота",
  },
  { path: "/contracts", label: "Договори", icon: <FileTextOutlined />, group: "Робота" },
  { path: "/payers", label: "Платники", icon: <ApartmentOutlined />, group: "Робота" },
  { path: "/activity", label: "Журнал дій", icon: <HistoryOutlined />, permission: "activity.read", group: "Контроль" },
  { path: "/archive", label: "Архів", icon: <InboxOutlined />, permission: "records.archive", group: "Контроль" },
  {
    path: "/references",
    label: "Довідники",
    icon: <AppstoreOutlined />,
    permission: "subscribers.read",
    group: "Налаштування",
  },
  {
    path: "/id-series",
    label: "Серії ID",
    icon: <BarsOutlined />,
    permission: "subscribers.read",
    group: "Налаштування",
  },
  { path: "/users", label: "Користувачі", icon: <UserOutlined />, permission: "users.manage", group: "Налаштування" },
  { path: "/system", label: "Система", icon: <SettingOutlined />, permission: "system.read", group: "Налаштування" },
];

export interface NavSection {
  group: NavGroup | null;
  items: NavItem[];
}

// Items in their order, each run of one group under its heading; a group left without items has no heading
export function navSections(items: NavItem[]): NavSection[] {
  const sections: NavSection[] = [];
  for (const item of items) {
    const group = item.group ?? null;
    const last = sections.at(-1);
    if (last && last.group === group) last.items.push(item);
    else sections.push({ group, items: [item] });
  }
  return sections;
}

export function findActiveKeys(pathname: string): string[] {
  if (pathname === "/") return ["/"];
  return NAV_ITEMS.filter((item) => item.path !== "/" && `${pathname}/`.startsWith(`${item.path}/`)).map(
    (item) => item.path,
  );
}
