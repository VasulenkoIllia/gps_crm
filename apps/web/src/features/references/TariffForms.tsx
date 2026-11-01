import {
  BILLING_MODELS,
  moneyTextSchema,
  moneyToText,
  parseMoneyToKop,
  PROGRAM_REQUIRED,
  referenceNameSchema,
  SERVER_REQUIRED,
  type BillingModel,
  type Tariff,
} from "@gps_crm/shared";
import { Form, Input, Radio } from "antd";
import { useMemo } from "react";
import { DictSelect, FactList, FormModal, Money, MoneyInput, zodRule } from "../../ui";
import type { RowFormProps } from "./ReferenceTab";
import { useReferenceSave } from "./reference-form";
import { REFERENCE_TEXTS } from "./reference-texts";
import { createReference, createTariffVersion, updateReference, useReferenceOptions } from "./references.api";

const IN_USE_NOTE = "Цей тариф уже обраний, тому змінити можна лише назву. Для нової ціни створіть нову версію тарифу.";
const PERIOD_OPTIONS = Object.entries(BILLING_MODELS).map(([value, label]) => ({ value, label }));
const ANSWER_FIELDS = { priceKop: "price" };

interface TariffValues {
  programId: string;
  serverId: string;
  name: string;
  billingModel: BillingModel;
  price: string;
}

export function TariffForm({ row, open, onClose }: RowFormProps<Tariff>) {
  const [form] = Form.useForm<TariffValues>();
  const programs = useReferenceOptions("programs", open);
  const servers = useReferenceOptions("servers", open);
  const programId = Form.useWatch("programId", form);
  const serverOptions = useMemo(() => {
    const wanted = new Set((servers.items ?? []).filter((s) => s.programId === programId).map((s) => s.id));
    return servers.options.filter((option) => wanted.has(option.value));
  }, [servers.items, servers.options, programId]);
  const save = useReferenceSave(
    (input: object) => (row ? updateReference("tariffs", row.id, input) : createReference("tariffs", input)),
    { form, renamed: ANSWER_FIELDS, clearFields: ["name", "price"], isNew: !row, onDone: onClose },
  );
  // The server stands by this too: a form left open can still lose to a client's form (references.md П9)
  const isFrozen = row?.isSelected === true;

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : REFERENCE_TEXTS.tariffs.add}
      open={open}
      onSubmit={({ price, ...values }, isAddingAnother) => {
        const input = { ...values, priceKop: parseMoneyToKop(price) ?? 0 };
        save.submit(row ? { ...input, version: row.version } : input, isAddingAnother);
      }}
    >
      {isFrozen && <p className="form-note">{IN_USE_NOTE}</p>}
      <Form.Item
        label="Програма"
        name="programId"
        required
        initialValue={row?.programId}
        rules={[{ required: true, message: PROGRAM_REQUIRED }]}
      >
        <DictSelect
          options={programs.options}
          isLoading={programs.isLoading}
          hasError={programs.hasError}
          disabled={isFrozen}
          onChange={() => form.setFieldValue("serverId", undefined)}
        />
      </Form.Item>
      <Form.Item
        label="Сервер"
        name="serverId"
        required
        initialValue={row?.serverId}
        rules={[{ required: true, message: SERVER_REQUIRED }]}
      >
        <DictSelect
          options={serverOptions}
          isLoading={servers.isLoading}
          hasError={servers.hasError}
          disabled={isFrozen}
        />
      </Form.Item>
      <Form.Item label="Назва" name="name" required initialValue={row?.name} rules={[zodRule(referenceNameSchema)]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Період"
        name="billingModel"
        required
        initialValue={row?.billingModel ?? "month"}
        rules={[{ required: true, message: "Оберіть період" }]}
      >
        <Radio.Group options={PERIOD_OPTIONS} disabled={isFrozen} />
      </Form.Item>
      <Form.Item
        label="Ціна за період"
        name="price"
        required
        initialValue={row ? moneyToText(row.priceKop) : undefined}
        rules={[zodRule(moneyTextSchema)]}
      >
        <MoneyInput disabled={isFrozen} />
      </Form.Item>
    </FormModal>
  );
}

interface VersionValues {
  name: string;
  price: string;
}

interface TariffVersionModalProps {
  source: Tariff | null;
  onClose: () => void;
}

// П9: the old tariff is not touched, and the people on it move in their own cards
export function TariffVersionModal({ source, onClose }: TariffVersionModalProps) {
  const [form] = Form.useForm<VersionValues>();
  const save = useReferenceSave(
    ({ name, price }: VersionValues) =>
      createTariffVersion(source?.id ?? "", { name, priceKop: parseMoneyToKop(price) ?? 0 }),
    { form, renamed: ANSWER_FIELDS, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={`Нова версія тарифу: ${source?.name ?? ""}`}
      submitLabel="Створити тариф"
      open={source !== null}
      onSubmit={(values) => save.submit(values)}
    >
      {source && (
        <FactList
          items={[
            { label: "Програма", value: source.programName },
            { label: "Сервер", value: source.serverName },
            { label: "Період", value: BILLING_MODELS[source.billingModel] },
            { label: "Чинна ціна", value: <Money kop={source.priceKop} /> },
          ]}
        />
      )}
      <Form.Item label="Назва нового тарифу" name="name" required rules={[zodRule(referenceNameSchema)]}>
        <Input autoComplete="off" autoFocus />
      </Form.Item>
      <Form.Item label="Нова ціна за період" name="price" required rules={[zodRule(moneyTextSchema)]}>
        <MoneyInput />
      </Form.Item>
    </FormModal>
  );
}
