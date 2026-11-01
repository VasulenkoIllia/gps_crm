import { Skeleton } from "antd";
import { useCurrentUser } from "../../lib/session";
import { PageHeader } from "../../ui";
import { PasswordForm, ProfileForm } from "./ProfileForms";
import { SessionsPanel } from "./SessionsPanel";
import { TwoFactorPanel } from "./TwoFactorPanel";

export function ProfilePage() {
  const { data: user } = useCurrentUser();
  return (
    <>
      <PageHeader title="Профіль" />
      {user ? <ProfileForm user={user} /> : <Skeleton active />}
      <PasswordForm />
      <TwoFactorPanel />
      <SessionsPanel />
    </>
  );
}
