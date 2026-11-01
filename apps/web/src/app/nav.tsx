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
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Головна", icon: <DashboardOutlined /> },
  { path: "/subscribers", label: "Клієнти", icon: <TeamOutlined /> },
  { path: "/objects", label: "Об'єкти", icon: <CarOutlined /> },
  { path: "/contracts", label: "Договори", icon: <FileTextOutlined /> },
  { path: "/payers", label: "Платники", icon: <ApartmentOutlined /> },
  { path: "/equipment", label: "Обладнання та SIM", icon: <HddOutlined /> },
  { path: "/references", label: "Довідники", icon: <AppstoreOutlined />, permission: "subscribers.read" },
  { path: "/id-series", label: "Серії ID", icon: <BarsOutlined />, permission: "subscribers.read" },
  { path: "/users", label: "Користувачі", icon: <UserOutlined />, permission: "users.manage" },
  { path: "/activity", label: "Журнал дій", icon: <HistoryOutlined />, permission: "activity.read" },
  { path: "/archive", label: "Архів", icon: <InboxOutlined />, permission: "records.archive" },
  { path: "/system", label: "Система", icon: <SettingOutlined />, permission: "system.read" },
];

export function findActiveKeys(pathname: string): string[] {
  if (pathname === "/") return ["/"];
  return NAV_ITEMS.filter((item) => item.path !== "/" && `${pathname}/`.startsWith(`${item.path}/`)).map(
    (item) => item.path,
  );
}
