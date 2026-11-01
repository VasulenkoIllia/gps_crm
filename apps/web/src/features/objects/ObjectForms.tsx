import {
  nextObjectStatuses,
  objectNameSchema,
  OBJECT_STATUS_META,
  type ObjectAddonAction,
  type ObjectCard,
  type ObjectStatus,
} from "@gps_crm/shared";
import { Form, Input, Radio } from "antd";
import { useMemo } from "react";
import { DateInput, DictSelect, FormModal, zodRule } from "../../ui";
import { PastDateField } from "../equipment/EquipmentFields";
import { defaultValidFrom, useRecordSave } from "../references/reference-form";
import { isTariffDateRefused } from "../subscribers/subscriber-form";
import { refreshClients } from "../subscribers/subscribers.api";
import { TariffFields } from "../subscribers/TariffFields";
import { useReferenceOptions } from "../references/references.api";
import { useAddonOptions, usePayerOptions } from "./object-form";
import { objectAction, updateObject } from "./objects.api";

const NOTE_ROWS = 3;
const DATE_TEXT = "Оберіть дату";

export interface ObjectFormProps {
  card: ObjectCard;
  open: boolean;
  onClose: () => void;
}

interface EditValues {
  name: string;
  note?: string;
}

export function ObjectEditModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<EditValues>();
  const save = useRecordSave((input: object) => updateObject(card.id, input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal
      {...save.modal}
      title="Змінити об'єкт"
      open={open}
      onSubmit={({ name, note }) => save.submit({ name, note: note || null, version: card.version }, false)}
    >
      <Form.Item label="Назва" name="name" required initialValue={card.name} rules={[zodRule(objectNameSchema)]}>
        <Input />
      </Form.Item>
      <Form.Item label="Примітка" name="note" initialValue={card.note ?? undefined}>
        <Input.TextArea rows={NOTE_ROWS} />
      </Form.Item>
    </FormModal>
  );
}

interface StatusValues {
  status: ObjectStatus;
  validFrom: string;
  reasonId?: string;
  note?: string;
}

export function ObjectStatusModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<StatusValues>();
  const reasons = useReferenceOptions("disconnect-reasons", open);
  const status = Form.useWatch("status", form) as ObjectStatus | undefined;
  const save = useRecordSave((input: object) => objectAction(card.id, "status", input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  const options = useMemo(
    () =>
      nextObjectStatuses(card.status).map((value) => ({
        value,
        label: OBJECT_STATUS_META[value].label,
        isActive: true,
      })),
    [card.status],
  );
  return (
    <FormModal
      {...save.modal}
      title="Змінити статус"
      open={open}
      onSubmit={({ note, ...values }) => save.submit({ ...values, note: note || null }, false)}
    >
      <Form.Item label="Статус" name="status" required rules={[{ required: true, message: "Оберіть статус" }]}>
        <DictSelect options={options} />
      </Form.Item>
      <PastDateField label="Діє з" name="validFrom" />
      {status === "disconnected" && (
        <Form.Item
          label="Причина відключення"
          name="reasonId"
          required
          rules={[{ required: true, message: "Вкажіть причину відключення" }]}
        >
          <DictSelect options={reasons.options} isLoading={reasons.isLoading} hasError={reasons.hasError} />
        </Form.Item>
      )}
      <Form.Item label="Примітка" name="note">
        <Input.TextArea rows={NOTE_ROWS} />
      </Form.Item>
    </FormModal>
  );
}

type TariffSource = "client" | "own";

const TARIFF_SOURCES = [
  { value: "client", label: "Тариф клієнта" },
  { value: "own", label: "Свій тариф" },
];

interface TariffValues {
  source: TariffSource;
  validFrom: string;
  programId?: string;
  tariffId?: string;
}

export function ObjectTariffModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<TariffValues>();
  const source = Form.useWatch("source", form) as TariffSource | undefined;
  const save = useRecordSave((input: object) => objectAction(card.id, "terms", input), {
    form,
    renamed: { "ownTariff.programId": "programId", "ownTariff.tariffId": "tariffId" },
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal
      {...save.modal}
      title="Тариф об'єкта"
      open={open}
      onSubmit={({ source: chosen, validFrom, programId, tariffId }) =>
        save.submit({ validFrom, ownTariff: chosen === "own" ? { programId, tariffId } : null }, false)
      }
    >
      <Form.Item name="source" initialValue={card.tariff.isOwn ? "own" : "client"}>
        <Radio.Group options={TARIFF_SOURCES} optionType="button" />
      </Form.Item>
      {source === "own" ? (
        <TariffFields open={open} dateName="validFrom" initial={{ programId: card.tariff.programId }} />
      ) : (
        <Form.Item
          label="Діє з"
          name="validFrom"
          required
          initialValue={defaultValidFrom()}
          rules={[{ required: true, message: DATE_TEXT }]}
        >
          <DateInput className="form-control-wide" disabledDate={isTariffDateRefused} />
        </Form.Item>
      )}
    </FormModal>
  );
}

interface PayerValues {
  payerId: string;
  validFrom: string;
}

export function ObjectPayerModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<PayerValues>();
  const payers = usePayerOptions(card.subscriberId, open);
  const save = useRecordSave((input: object) => objectAction(card.id, "terms", input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal {...save.modal} title="Змінити платника" open={open} onSubmit={(values) => save.submit(values, false)}>
      <Form.Item
        label="Платник"
        name="payerId"
        required
        initialValue={card.payerId}
        rules={[{ required: true, message: "Оберіть платника цього клієнта" }]}
      >
        <DictSelect options={payers.options} isLoading={payers.isLoading} hasError={payers.hasError} />
      </Form.Item>
      <PastDateField label="Діє з" name="validFrom" />
    </FormModal>
  );
}

interface AddonValues {
  addonId: string;
  date: string;
}

interface ObjectAddonModalProps extends ObjectFormProps {
  action: ObjectAddonAction;
  // The service to disconnect: a row of the tab has already said which
  addonId?: string;
}

export function ObjectAddonModal({ card, action, addonId, open, onClose }: ObjectAddonModalProps) {
  const [form] = Form.useForm<AddonValues>();
  const addons = useAddonOptions(card.tariff.programId, open && action === "connect");
  const connected = useMemo(() => card.addons.map((addon) => addon.addonId), [card.addons]);
  const options = useMemo(
    () => addons.options.filter((option) => !connected.includes(option.value)),
    [addons.options, connected],
  );
  const save = useRecordSave((input: object) => objectAction(card.id, "addons", input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal
      {...save.modal}
      title={action === "connect" ? "Підключити послугу" : "Відключити послугу"}
      open={open}
      onSubmit={(values) => save.submit({ ...values, addonId: addonId ?? values.addonId, action }, false)}
    >
      {action === "connect" && (
        <Form.Item label="Послуга" name="addonId" required rules={[{ required: true, message: "Оберіть послугу" }]}>
          <DictSelect options={options} isLoading={addons.isLoading} hasError={addons.hasError} />
        </Form.Item>
      )}
      <PastDateField label={action === "connect" ? "Діє з" : "Дата відключення"} name="date" />
    </FormModal>
  );
}
