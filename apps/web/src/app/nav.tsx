import {
  ApartmentOutlined,
  AppstoreOutlined,
  CarOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HddOutlined,
  HistoryOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

export interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Головна", icon: <DashboardOutlined /> },
  { path: "/subscribers", label: "Клієнти", icon: <TeamOutlined /> },
  { path: "/objects", label: "Об'єкти", icon: <CarOutlined /> },
  { path: "/contracts", label: "Договори", icon: <FileTextOutlined /> },
  { path: "/payers", label: "Платники", icon: <ApartmentOutlined /> },
  { path: "/equipment", label: "Обладнання та SIM", icon: <HddOutlined /> },
  { path: "/references", label: "Довідники", icon: <AppstoreOutlined /> },
  { path: "/users", label: "Користувачі", icon: <UserOutlined /> },
  { path: "/activity", label: "Журнал дій", icon: <HistoryOutlined /> },
  { path: "/system", label: "Система", icon: <SettingOutlined /> },
];

export function findActiveKeys(pathname: string): string[] {
  if (pathname === "/") return ["/"];
  return NAV_ITEMS.filter((item) => item.path !== "/" && `${pathname}/`.startsWith(`${item.path}/`)).map(
    (item) => item.path,
  );
}
