import type { FormInstance } from "antd";
import type { Rule } from "antd/es/form";
import { ApiError } from "../lib/api";

const UNEXPECTED_ERROR = "Сталася помилка. Спробуйте ще раз.";

interface Schema {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } };
}

// The form checks with the schema the server checks with, so a rule cannot drift apart
export function zodRule(schema: Schema): Rule {
  return {
    validator: (_, value: unknown) => {
      const result = schema.safeParse(value);
      if (result.success) return Promise.resolve();
      return Promise.reject(new Error(result.error?.issues[0]?.message ?? UNEXPECTED_ERROR));
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : UNEXPECTED_ERROR;
}

// Puts an answer of the server under its field. `renamed` is for a form whose field differs from the name in the answer.
export function showFieldErrors<T>(form: FormInstance<T>, error: unknown, renamed: Record<string, string> = {}): void {
  if (!(error instanceof ApiError) || !error.fieldErrors) return;
  const fields = Object.entries(error.fieldErrors).map(([name, message]) => ({
    name: renamed[name] ?? name,
    errors: [message],
  }));
  form.setFields(fields as Parameters<typeof form.setFields>[0]);
}
