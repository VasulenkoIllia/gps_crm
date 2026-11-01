import { recoveryCodesSchema, twoFactorSetupSchema, type TwoFactorConfirm } from "@gps_crm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Form, Input, Skeleton } from "antd";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { apiPost } from "../../lib/api";
import { queryClient } from "../../lib/query-client";
import { CURRENT_USER_KEY, logout, useCurrentUser } from "../../lib/session";
import { CopyButton, FormAlert, LoadError } from "../../ui";
import { AuthTitle } from "./AuthTitle";
import { RecoveryCodesList } from "./RecoveryCodesList";

// How long an abandoned setup keeps its secret in memory. Not zero: a timer of 0 can fire between the render and the
// commit, and a second POST would issue a new secret behind the QR on the screen.
const SETUP_CACHE_MS = 5_000;

// A query, not an effect: each call issues a new secret, and the strict mode's double mount must not show the older one
function useSetup() {
  return useQuery({
    queryKey: ["two-factor-setup"],
    queryFn: () => apiPost("/me/2fa/setup", twoFactorSetupSchema),
    staleTime: Infinity,
    gcTime: SETUP_CACHE_MS,
    retry: false,
  });
}

function CodesStep({ codes }: { codes: string[] }) {
  const navigate = useNavigate();
  const [isSaved, setSaved] = useState(false);

  return (
    <>
      <AuthTitle
        title="Коди відновлення"
        hint="Збережіть їх у надійному місці. Кожен код спрацьовує один раз, якщо телефон недоступний. Більше я їх не покажу."
      />
      <RecoveryCodesList codes={codes} />
      <Checkbox className="auth-check" checked={isSaved} onChange={(event) => setSaved(event.target.checked)}>
        Коди збережено
      </Checkbox>
      <div className="auth-links">
        <Button type="primary" block disabled={!isSaved} onClick={() => void navigate("/", { replace: true })}>
          Перейти до роботи
        </Button>
      </div>
    </>
  );
}

function ScanStep({ onDone }: { onDone: (codes: string[]) => void }) {
  const { message } = App.useApp();
  const setup = useSetup();
  const confirm = useMutation({
    mutationFn: (input: TwoFactorConfirm) => apiPost("/me/2fa/confirm", recoveryCodesSchema, input),
    onSuccess: ({ recoveryCodes }) => {
      onDone(recoveryCodes);
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    },
  });
  const signOut = useMutation({ mutationFn: logout, onError: () => void message.error("Не вдалося вийти") });

  // 2FA switched on in another tab answers 409 for good: the fresh user sends the person on from here
  function retrySetup() {
    void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    void setup.refetch();
  }

  if (setup.error) return <LoadError error={setup.error} onRetry={retrySetup} />;
  if (!setup.data) return <Skeleton active />;

  return (
    <>
      <AuthTitle
        title="Двофакторний вхід"
        hint="Це обов'язковий крок. Відскануйте QR-код застосунком (Google Authenticator, Microsoft Authenticator, 1Password) і введіть код."
      />
      <img className="qr-code" src={setup.data.qrDataUrl} alt="QR-код для застосунку" />
      <Alert
        className="form-alert"
        type="info"
        title="Не вдається відсканувати? Введіть цей ключ у застосунку вручну:"
        description={
          <>
            <code className="manual-secret">{setup.data.secret}</code>
            <CopyButton value={setup.data.secret} label="Скопіювати ключ" />
          </>
        }
      />
      <FormAlert error={confirm.error} />
      <Form<TwoFactorConfirm> layout="vertical" onFinish={(values) => confirm.mutate(values)}>
        <Form.Item label="Код із застосунку" name="code" required rules={[{ required: true, message: "Введіть код" }]}>
          <Input inputMode="numeric" autoComplete="one-time-code" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={confirm.isPending}>
          Увімкнути
        </Button>
      </Form>
      <div className="auth-links">
        <Button type="link" style={{ padding: 0 }} loading={signOut.isPending} onClick={() => signOut.mutate()}>
          Вийти
        </Button>
      </div>
    </>
  );
}

export function TwoFactorSetupPage() {
  const { data: user } = useCurrentUser();
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) return <CodesStep codes={codes} />;
  if (user?.twoFactorEnabled) return <Navigate to="/" replace />;
  return <ScanStep onDone={setCodes} />;
}
