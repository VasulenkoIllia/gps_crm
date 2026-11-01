import { MoreOutlined } from "@ant-design/icons";
import { USER_STATUS, type UserListItem } from "@gps_crm/shared";
import { Button, Dropdown, type MenuProps } from "antd";

export type UserAction = "reinvite" | "copyInvite" | "sendReset" | "copyReset" | "block" | "unblock" | "resetTwoFactor";

type ActionItem = NonNullable<MenuProps["items"]>[number];

const LABELS: Record<UserAction, string> = {
  reinvite: "Надіслати запрошення ще раз",
  copyInvite: "Скопіювати посилання запрошення",
  sendReset: "Надіслати лист для скидання пароля",
  copyReset: "Скопіювати посилання для скидання пароля",
  block: "Заблокувати",
  unblock: "Розблокувати",
  resetTwoFactor: "Скинути 2FA",
};

export function actionsFor(user: UserListItem, isSelf: boolean): UserAction[] {
  if (user.status === USER_STATUS.blocked) return ["unblock"];
  if (user.status === USER_STATUS.invited) return ["reinvite", "copyInvite", "block"];
  if (isSelf) return [];
  return ["sendReset", "copyReset", ...(user.twoFactorEnabled ? (["resetTwoFactor"] as const) : []), "block"];
}

interface UserActionsProps {
  fullName: string;
  actions: UserAction[];
  isBusy: boolean;
  onAction: (action: UserAction) => void;
}

export function UserActions({ fullName, actions, isBusy, onAction }: UserActionsProps) {
  if (actions.length === 0) return null;
  const items: ActionItem[] = actions.map((action) => ({ key: action, label: LABELS[action] }));
  return (
    <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => onAction(key as UserAction) }}>
      {/* A plain title, not antd's Tooltip: between Dropdown and Button it costs the focus after Esc */}
      <Button type="text" icon={<MoreOutlined />} title="Дії" aria-label={`Дії: ${fullName}`} disabled={isBusy} />
    </Dropdown>
  );
}
