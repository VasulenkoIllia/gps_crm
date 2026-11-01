import { firstOfNextMonth, parseMoneyToKop, todayKyiv, type DatedPrice } from "@gps_crm/shared";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
  const isPlaced = Object.keys(error.fieldErrors).every((name) => {
    const [top = ""] = (renamed[name] ?? name).split(".");
    return fields.includes(top);
  });
  return isPlaced ? null : error;
}

interface ReferenceSaveOptions<T, R> {
  form: FormInstance<T>;
  // A name in the answer that differs from the field of the form (the API speaks kopecks, the form text)
  renamed?: Record<string, string>;
  // Offers «Зберегти й додати ще», which clears these and keeps the rest for the next record of a list (§5.4)
  clearFields?: (string | string[])[];
  // Where the next record starts. Without it, the name
  firstField?: string | string[];
  isNew?: boolean;
  onDone: () => void;
  // What else a change touches. Without it, the lists of the reference module
  refresh?: (client: QueryClient) => void;
  // The label of the second way to save, for a form with a word of its own
  addAnotherText?: string;
  // What the toast says, and what follows a save that closes the form
  savedText?: (result: R) => string;
  onSaved?: (result: R) => void;
}

export function useRecordSave<I, T extends object, R>(
  save: (input: I) => Promise<R>,
  options: ReferenceSaveOptions<T, R>,
) {
  const { form, renamed, clearFields, isNew, onDone, addAnotherText, savedText, onSaved } = options;
  const firstField = options.firstField ?? "name";
  const refresh = options.refresh ?? refreshAfterChange;
  const client = useQueryClient();
  const { message } = App.useApp();

  function startNextRecord() {
    form.resetFields(clearFields as Parameters<typeof form.resetFields>[0]);
    // What stays for the next record is not unsaved work: closing now loses nothing
    const kept = Object.keys(form.getFieldsValue()).map((name) => ({ name, touched: false }));
    form.setFields(kept as Parameters<typeof form.setFields>[0]);
    form.focusField(firstField as Parameters<typeof form.focusField>[0]);
  }

  const mutation = useMutation({
    mutationFn: ({ input }: { input: I; isAddingAnother: boolean }) => save(input),
    onSuccess: (result, { isAddingAnother }) => {
      refresh(client);
      void message.success(savedText?.(result) ?? SAVED);
      if (isAddingAnother) {
        startNextRecord();
        return;
      }
      onDone();
      onSaved?.(result);
    },
    onError: (error) => {
      showFieldErrors(form, error, renamed);
      if (error instanceof ApiError && STALE_FORM_STATUSES.includes(error.status)) refresh(client);
    },
  });

  return {
    submit: (input: I, isAddingAnother = false) => mutation.mutate({ input, isAddingAnother }),
    modal: {
      form,
      submitLabel: SAVE_LABEL,
      addAnotherLabel: isNew ? (addAnotherText ?? ADD_ANOTHER_LABEL) : undefined,
      isSubmitting: mutation.isPending,
      error: mutation.error && formLevelError(mutation.error, Object.keys(form.getFieldsValue()), renamed),
      onClose: () => {
        mutation.reset();
        onDone();
      },
    },
  };
}

// A create and a change share a form here, so what the save returns differs and nothing reads it
export function useReferenceSave<I, T extends object>(
  save: (input: I) => Promise<unknown>,
  options: ReferenceSaveOptions<T, unknown>,
) {
  return useRecordSave(save, options);
}
