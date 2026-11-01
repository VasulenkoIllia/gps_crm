import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Dropdown, type MenuProps } from "antd";
import { useNavigate } from "react-router";
import { logout, useCurrentUser } from "../lib/session";
import { errorMessage } from "../ui";

const ITEMS: MenuProps["items"] = [
  { key: "profile", label: "Профіль", icon: <UserOutlined /> },
  { key: "logout", label: "Вийти", icon: <LogoutOutlined /> },
];

export function UserMenu() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { data: user } = useCurrentUser();
  const signOut = useMutation({
    mutationFn: logout,
    onError: (error) => void message.error(errorMessage(error)),
  });

  function handleClick({ key }: { key: string }) {
    if (key === "profile") void navigate("/profile");
    else signOut.mutate();
  }

  return (
    <Dropdown trigger={["click"]} menu={{ items: ITEMS, onClick: handleClick }}>
      <Button
        type="text"
        className="user-menu"
        icon={<UserOutlined />}
        loading={signOut.isPending}
        aria-label="Меню користувача"
      >
        <span className="user-menu-name">{user?.fullName}</span>
      </Button>
    </Dropdown>
  );
}
