import {
  DEVICE_OWNERSHIPS,
  DEVICE_STATUS_META,
  iccidSchema,
  imeiSchema,
  serialNoSchema,
  SIM_STATUS_META,
  type DeviceRow,
  type SensorRow,
  type SimRow,
} from "@gps_crm/shared";
import { Form, Input } from "antd";
import { DictSelect, FormModal, zodRule } from "../../ui";
import { useReferenceSave } from "../references/reference-form";
import { useReferenceOptions } from "../references/references.api";
import { refreshClients } from "../subscribers/subscribers.api";
import { checkIccid, checkImei, registerEquipment, updateEquipment } from "./equipment.api";
import { SimDetailFields } from "./EquipmentFields";
import { NumberHint, useNumberCheck } from "./NumberHint";

const OWNERSHIP_OPTIONS = Object.entries(DEVICE_OWNERSHIPS).map(([value, label]) => ({ value, label, isActive: true }));
const NOTE_ROWS = 3;

function statusOptions(meta: Record<string, { label: string }>) {
  return Object.entries(meta).map(([value, { label }]) => ({ value, label, isActive: true }));
}

const DEVICE_STATE_OPTIONS = statusOptions(DEVICE_STATUS_META);
const SIM_STATE_OPTIONS = statusOptions(SIM_STATUS_META);

interface RowFormProps<T> {
  row: T | null;
  open: boolean;
  onClose: () => void;
}

interface DeviceValues {
  imei: string;
  modelId?: string | null;
  ownership?: string | null;
  status?: string;
  note?: string;
}

export function DeviceForm({ row, open, onClose }: RowFormProps<DeviceRow>) {
  const [form] = Form.useForm<DeviceValues>();
  const models = useReferenceOptions("tracker-models", open);
  const imei = Form.useWatch("imei", form) as string | undefined;
  const found = useNumberCheck("imei", imei, checkImei, row?.id);
  const save = useReferenceSave(
    (input: object) => (row ? updateEquipment("devices", row.id, input) : registerEquipment("devices", input)),
    { form, clearFields: ["imei", "note"], firstField: "imei", isNew: !row, refresh: refreshClients, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити трекер ${row.imei}` : "Новий трекер"}
      open={open}
      onSubmit={({ modelId, ownership, note, ...values }, isAddingAnother) => {
        const fields = { ...values, modelId: modelId ?? null, ownership: ownership ?? null, note: note || null };
        save.submit(row ? { ...fields, version: row.version } : fields, isAddingAnother);
      }}
    >
      {!row && <p className="form-note">Дата встановлення з'явиться, коли трекер поставлять на об'єкт.</p>}
      <NumberHint result={found} />
      <Form.Item label="IMEI" name="imei" required initialValue={row?.imei} rules={[zodRule(imeiSchema)]}>
        <Input autoFocus inputMode="numeric" />
      </Form.Item>
      <Form.Item label="Модель" name="modelId" initialValue={row?.modelId ?? undefined}>
        <DictSelect options={models.options} isLoading={models.isLoading} hasError={models.hasError} />
      </Form.Item>
      <Form.Item label="Власність" name="ownership" initialValue={row?.ownership ?? undefined}>
        <DictSelect options={OWNERSHIP_OPTIONS} />
      </Form.Item>
      {row && (
        <Form.Item label="Стан" name="status" required initialValue={row.status}>
          <DictSelect options={DEVICE_STATE_OPTIONS} />
        </Form.Item>
      )}
      <Form.Item label="Примітка" name="note" initialValue={row?.note ?? undefined}>
        <Input.TextArea rows={NOTE_ROWS} />
      </Form.Item>
    </FormModal>
  );
}

interface SimValues {
  iccid: string;
  msisdn?: string | null;
  operatorId?: string | null;
  planId?: string | null;
  status?: string;
  note?: string;
}

export function SimForm({ row, open, onClose }: RowFormProps<SimRow>) {
  const [form] = Form.useForm<SimValues>();
  const iccid = Form.useWatch("iccid", form) as string | undefined;
  const found = useNumberCheck("iccid", iccid, checkIccid, row?.id);
  const save = useReferenceSave(
    (input: object) => (row ? updateEquipment("sims", row.id, input) : registerEquipment("sims", input)),
    {
      form,
      clearFields: ["iccid", "msisdn", "note"],
      firstField: "iccid",
      isNew: !row,
      refresh: refreshClients,
      onDone: onClose,
    },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити SIM ${row.iccid}` : "Нова SIM-картка"}
      open={open}
      onSubmit={({ msisdn, operatorId, planId, note, ...values }, isAddingAnother) => {
        const fields = {
          ...values,
          msisdn: msisdn || null,
          operatorId: operatorId ?? null,
          planId: planId ?? null,
          note: note || null,
        };
        save.submit(row ? { ...fields, version: row.version } : fields, isAddingAnother);
      }}
    >
      <NumberHint result={found} />
      <Form.Item label="ICCID" name="iccid" required initialValue={row?.iccid} rules={[zodRule(iccidSchema)]}>
        <Input autoFocus inputMode="numeric" />
      </Form.Item>
      <SimDetailFields open={open} initial={row ?? undefined} />
      {row && (
        <Form.Item label="Стан" name="status" required initialValue={row.status}>
          <DictSelect options={SIM_STATE_OPTIONS} />
        </Form.Item>
      )}
      <Form.Item label="Примітка" name="note" initialValue={row?.note ?? undefined}>
        <Input.TextArea rows={NOTE_ROWS} />
      </Form.Item>
    </FormModal>
  );
}

interface SensorValues {
  serialNo: string;
  note?: string;
}

export function SensorForm({ row, open, onClose }: RowFormProps<SensorRow>) {
  const [form] = Form.useForm<SensorValues>();
  const save = useReferenceSave(
    (input: object) => (row ? updateEquipment("sensors", row.id, input) : registerEquipment("sensors", input)),
    {
      form,
      clearFields: ["serialNo", "note"],
      firstField: "serialNo",
      isNew: !row,
      refresh: refreshClients,
      onDone: onClose,
    },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити датчик ${row.serialNo}` : "Новий датчик"}
      open={open}
      onSubmit={({ note, ...values }, isAddingAnother) => {
        const fields = { ...values, note: note || null };
        save.submit(row ? { ...fields, version: row.version } : fields, isAddingAnother);
      }}
    >
      <Form.Item
        label="Серійний номер"
        name="serialNo"
        required
        initialValue={row?.serialNo}
        rules={[zodRule(serialNoSchema)]}
      >
        <Input autoFocus />
      </Form.Item>
      <Form.Item label="Примітка" name="note" initialValue={row?.note ?? undefined}>
        <Input.TextArea rows={NOTE_ROWS} />
      </Form.Item>
    </FormModal>
  );
}
