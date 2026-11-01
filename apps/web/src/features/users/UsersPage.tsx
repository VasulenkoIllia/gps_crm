import { LINK_DELIVERY, roleLabel, USER_STATUS_META, type LinkDelivery, type UserListItem } from "@gps_crm/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { useMemo, useState } from "react";
import { useCan, useCurrentUser } from "../../lib/session";
import {
  ConfirmAction,
  CopyButton,
  DataTable,
  DateTimeText,
  errorMessage,
  InfoModal,
  NoAccess,
  PageHeader,
  Panel,
  StatusTag,
  type DataTableColumn,
} from "../../ui";
import { InviteUserModal } from "./InviteUserModal";
import { ResetTwoFactorModal } from "./ResetTwoFactorModal";
import { actionsFor, UserActions, type UserAction } from "./UserActions";
import { blockUser, createResetLink, fetchUsersPage, reinviteUser, unblockUser, USERS_KEY } from "./users.api";

type LinkRequest = "reinvite" | "copyInvite" | "sendReset" | "copyReset";

function requestLink(action: LinkRequest, id: string): Promise<LinkDelivery> {
  if (action === "reinvite") return reinviteUser(id, true);
  if (action === "copyInvite") return reinviteUser(id, false);
  return createResetLink(id, action === "sendReset");
}

function buildColumns(
  currentUserId: string | undefined,
  isBusy: boolean,
  onAction: (user: UserListItem, action: UserAction) => void,
): DataTableColumn<UserListItem>[] {
  return [
    { title: "ПІБ", dataIndex: "fullName" },
    { title: "Email", dataIndex: "email" },
    { title: "Роль", dataIndex: "roleKey", render: roleLabel },
    {
      title: "Статус",
      dataIndex: "status",
      render: (_, user) => <StatusTag status={USER_STATUS_META[user.status]} />,
    },
    { title: "2FA", dataIndex: "twoFactorEnabled", render: (isOn: boolean) => (isOn ? "Увімкнено" : "Ні") },
    {
      title: "Останній вхід",
      dataIndex: "lastLoginAt",
      render: (value: string | null) => <DateTimeText value={value} />,
    },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, user) => (
        <UserActions
          fullName={user.fullName}
          actions={actionsFor(user, user.id === currentUserId)}
          isBusy={isBusy}
          onAction={(action) => onAction(user, action)}
        />
      ),
    },
  ];
}

function UsersScreen() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const { data: currentUser } = useCurrentUser();
  const [isInviting, setInviting] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<UserListItem | null>(null);
  const [unblocking, setUnblocking] = useState<UserListItem | null>(null);
  const [resetting, setResetting] = useState<UserListItem | null>(null);

  const users = useInfiniteQuery({
    queryKey: USERS_KEY,
    queryFn: ({ pageParam, signal }) => fetchUsersPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => users.data?.pages.flatMap((page) => page.items), [users.data]);
  const refresh = () => client.invalidateQueries({ queryKey: USERS_KEY });

  function showDelivery(delivery: LinkDelivery) {
    void refresh();
    if (delivery.delivery === LINK_DELIVERY.manual) setManualLink(delivery.link);
    else void message.success("Лист надіслано");
  }

  const link = useMutation({
    mutationFn: ({ action, id }: { action: LinkRequest; id: string }) => requestLink(action, id),
    onSuccess: showDelivery,
    onError: (error) => void message.error(errorMessage(error)),
  });
  const statusChange = useMutation({
    mutationFn: ({ id, change }: { id: string; change: (id: string) => Promise<void> }) => change(id),
    onSuccess: () => {
      void refresh();
      setBlocking(null);
      setUnblocking(null);
      void message.success("Статус змінено");
    },
    onError: (error) => void message.error(errorMessage(error)),
  });

  const { mutate: sendLink, isPending: isSendingLink } = link;
  const columns = useMemo(() => {
    function handleAction(user: UserListItem, action: UserAction) {
      if (action === "block") setBlocking(user);
      else if (action === "unblock") setUnblocking(user);
      else if (action === "resetTwoFactor") setResetting(user);
      else sendLink({ action, id: user.id });
    }
    return buildColumns(currentUser?.id, isSendingLink, handleAction);
  }, [currentUser?.id, sendLink, isSendingLink]);

  return (
    <>
      <PageHeader
        title="Користувачі"
        actions={
          <Button type="primary" onClick={() => setInviting(true)}>
            Запросити
          </Button>
        }
      />
      <Panel>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey="id"
          error={users.error}
          empty="Користувачів ще немає"
          onRetry={() => void users.refetch()}
          hasMore={users.hasNextPage}
          isLoadingMore={users.isFetchingNextPage}
          onLoadMore={() => void users.fetchNextPage()}
        />
      </Panel>
      <InviteUserModal
        open={isInviting}
        onClose={() => setInviting(false)}
        onInvited={(delivery) => {
          setInviting(false);
          showDelivery(delivery);
        }}
      />
      <ResetTwoFactorModal
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={() => {
          setResetting(null);
          void refresh();
          void message.success("2FA скинуто");
        }}
      />
      <ConfirmAction
        title={`Заблокувати: ${blocking?.fullName ?? ""}?`}
        consequence="Людина одразу вийде із системи й не зможе увійти, поки її не розблокують."
        actionLabel="Заблокувати"
        open={blocking !== null}
        isPending={statusChange.isPending}
        onConfirm={() => blocking && statusChange.mutate({ id: blocking.id, change: blockUser })}
        onClose={() => setBlocking(null)}
      />
      <ConfirmAction
        title={`Розблокувати: ${unblocking?.fullName ?? ""}?`}
        consequence="Людина знову зможе увійти зі своїм паролем."
        actionLabel="Розблокувати"
        isDanger={false}
        open={unblocking !== null}
        isPending={statusChange.isPending}
        onConfirm={() => unblocking && statusChange.mutate({ id: unblocking.id, change: unblockUser })}
        onClose={() => setUnblocking(null)}
      />
      <InfoModal title="Лист не надіслано" open={manualLink !== null} onClose={() => setManualLink(null)}>
        <p>Передайте це посилання людині самостійно, наприклад у месенджері.</p>
        <div className="link-box">{manualLink}</div>
        <CopyButton value={manualLink ?? ""} label="Скопіювати посилання" />
      </InfoModal>
    </>
  );
}

export function UsersPage() {
  const canManage = useCan("users.manage");
  return canManage ? <UsersScreen /> : <NoAccess />;
}
