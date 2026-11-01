import {
  emailSchema,
  LOGIN_STATUS,
  loginResultSchema,
  type LoginInput,
  type LoginResult,
  type TwoFactorLoginInput,
} from "@gps_crm/shared";
import { useMutation } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError, apiPost } from "../../lib/api";
import { queryClient } from "../../lib/query-client";
import { safeNextPath } from "../../lib/login-path";
import { FormAlert, zodRule } from "../../ui";
import { AuthTitle } from "./AuthTitle";

const CHALLENGE_EXPIRED = "challenge_expired";

interface LoginFormProps {
  // Why the person is back at the first step; the next try replaces it
  notice: ApiError | null;
  onResult: (result: LoginResult) => void;
}

function LoginForm({ notice, onResult }: LoginFormProps) {
  const login = useMutation({
    mutationFn: (input: LoginInput) => apiPost("/auth/login", loginResultSchema, input),
    onSuccess: onResult,
  });

  return (
    <>
      <AuthTitle title="Вхід" />
      <FormAlert error={login.error ?? notice} />
      <Form<LoginInput> layout="vertical" onFinish={(values) => login.mutate(values)}>
        <Form.Item label="Email" name="email" required rules={[zodRule(emailSchema)]}>
          <Input type="email" autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item label="Пароль" name="password" required rules={[{ required: true, message: "Введіть пароль" }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={login.isPending}>
          Увійти
        </Button>
      </Form>
      <div className="auth-links">
        <Link to="/forgot-password">Забули пароль?</Link>
      </div>
    </>
  );
}

interface SecondStepFormProps {
  challenge: string;
  onResult: (result: LoginResult) => void;
  onExpired: (error: ApiError) => void;
  onBack: () => void;
}

function SecondStepForm({ challenge, onResult, onExpired, onBack }: SecondStepFormProps) {
  const secondStep = useMutation({
    mutationFn: ({ code }: Pick<TwoFactorLoginInput, "code">) =>
      apiPost("/auth/2fa", loginResultSchema, { challenge, code }),
    onSuccess: onResult,
    onError: (error) => {
      if (error instanceof ApiError && error.code === CHALLENGE_EXPIRED) onExpired(error);
    },
  });

  return (
    <>
      <AuthTitle title="Код підтвердження" hint="Введіть код із застосунку на телефоні або код відновлення." />
      <FormAlert error={secondStep.error} />
      <Form<Pick<TwoFactorLoginInput, "code">> layout="vertical" onFinish={(values) => secondStep.mutate(values)}>
        <Form.Item label="Код" name="code" required rules={[{ required: true, message: "Введіть код" }]}>
          <Input autoComplete="one-time-code" autoFocus />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={secondStep.isPending}>
          Підтвердити
        </Button>
      </Form>
      <div className="auth-links">
        <Button type="link" onClick={onBack} style={{ padding: 0 }}>
          Увійти іншим email
        </Button>
      </div>
    </>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [expired, setExpired] = useState<ApiError | null>(null);

  function goInside(path: string) {
    // Nothing of a previous person in this tab may meet the new session
    queryClient.clear();
    void navigate(path, { replace: true });
  }

  function handleResult(result: LoginResult) {
    if (result.status === LOGIN_STATUS.twoFactorRequired) {
      setExpired(null);
      setChallenge(result.challenge);
    } else if (result.status === LOGIN_STATUS.twoFactorSetupRequired) {
      goInside("/setup-2fa");
    } else {
      goInside(safeNextPath(searchParams.get("next")));
    }
  }

  function backToPassword(error: ApiError | null) {
    setExpired(error);
    setChallenge(null);
  }

  if (challenge) {
    return (
      <SecondStepForm
        challenge={challenge}
        onResult={handleResult}
        onExpired={backToPassword}
        onBack={() => backToPassword(null)}
      />
    );
  }
  return <LoginForm notice={expired} onResult={handleResult} />;
}
