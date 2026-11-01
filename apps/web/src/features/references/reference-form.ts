import { firstOfNextMonth, parseMoneyToKop, todayKyiv, type DatedPrice } from "@gps_crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, type FormInstance } from "antd";
import { ApiError } from "../../lib/api";
import { showFieldErrors } from "../../ui";
import { refreshAfterChange } from "./references.api";

const SAVED = "Збережено";
const SAVE_LABEL = "Зберегти";
const ADD_ANOTHER_LABEL = "Зберегти й додати ще";
// A conflict, or a parent that left the choice: what this form was opened on is out of date
const STALE_FORM_STATUSES = [409, 422];

// The default «діє з» of every dated price (references.md П3)
export function defaultValidFrom(): string {
  return firstOfNextMonth(todayKyiv());
}

// The rule of the field has seen the text by now, so kopecks are there: 0 would be refused by the API all the same
export function toDatedPrice(amount: string, validFrom: string): DatedPrice {
  return { amountKop: parseMoneyToKop(amount) ?? 0, validFrom };
}

// What the form cannot put under a field of its own stands on top of it, or it would not show at all
export function formLevelError(error: unknown, fields: string[], renamed: Record<string, string> = {}): unknown {
  if (!(error instanceof ApiError) || !error.fieldErrors) return error;
  const isPlaced = Object.keys(error.fieldErrors).every((name) => fields.includes(renamed[name] ?? name));
  return isPlaced ? null : error;
}

interface ReferenceSaveOptions<T> {
  form: FormInstance<T>;
  // A name in the answer that differs from the field of the form (the API speaks kopecks, the form text)
  renamed?: Record<string, string>;
  // Offers «Зберегти й додати ще», which clears these and keeps the rest for the next record of a list (§5.4)
  clearFields?: string[];
  isNew?: boolean;
  onDone: () => void;
}

export function useReferenceSave<I, T extends object>(
  save: (input: I) => Promise<unknown>,
  options: ReferenceSaveOptions<T>,
) {
  const { form, renamed, clearFields, isNew, onDone } = options;
  const client = useQueryClient();
  const { message } = App.useApp();

  function startNextRecord() {
    form.resetFields(clearFields as Parameters<typeof form.resetFields>[0]);
    // What stays for the next record is not unsaved work: closing now loses nothing
    const kept = Object.keys(form.getFieldsValue()).map((name) => ({ name, touched: false }));
    form.setFields(kept as Parameters<typeof form.setFields>[0]);
    form.focusField("name" as Parameters<typeof form.focusField>[0]);
  }

  const mutation = useMutation({
    mutationFn: ({ input }: { input: I; isAddingAnother: boolean }) => save(input),
    onSuccess: (_, { isAddingAnother }) => {
      refreshAfterChange(client);
      void message.success(SAVED);
      if (isAddingAnother) startNextRecord();
      else onDone();
    },
    onError: (error) => {
      showFieldErrors(form, error, renamed);
      if (error instanceof ApiError && STALE_FORM_STATUSES.includes(error.status)) refreshAfterChange(client);
    },
  });

  return {
    submit: (input: I, isAddingAnother = false) => mutation.mutate({ input, isAddingAnother }),
    modal: {
      form,
      submitLabel: SAVE_LABEL,
      addAnotherLabel: isNew ? ADD_ANOTHER_LABEL : undefined,
      isSubmitting: mutation.isPending,
      error: mutation.error && formLevelError(mutation.error, Object.keys(form.getFieldsValue()), renamed),
      onClose: () => {
        mutation.reset();
        onDone();
      },
    },
  };
}
