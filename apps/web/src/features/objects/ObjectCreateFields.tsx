import { DeleteOutlined } from "@ant-design/icons";
import { objectNameSchema, OBJECT_STATUS_META, type ObjectStatus, type SubscriberCard } from "@gps_crm/shared";
import { Button, Checkbox, Form, Input } from "antd";
import { useEffect, useRef } from "react";
import { DictSelect, RemoteSelect, zodRule } from "../../ui";
import { PastDateField, SensorChoiceField } from "../equipment/EquipmentFields";
import { useReferenceOptions } from "../references/references.api";
import { searchSubscribers } from "../subscribers/subscribers.api";
import { TariffFields } from "../subscribers/TariffFields";
import { useAddonOptions } from "./object-form";

const NOTE_ROWS = 3;
const STATUS_OPTIONS = Object.entries(OBJECT_STATUS_META).map(([value, { label }]) => ({
  value,
  label,
  isActive: true,
}));

export function ObjectMainFields({ open, isClientFixed }: { open: boolean; isClientFixed: boolean }) {
  const form = Form.useFormInstance();
  const reasons = useReferenceOptions("disconnect-reasons", open);
  const status = Form.useWatch("status", form) as ObjectStatus | undefined;
  return (
    <>
      {!isClientFixed && (
        <Form.Item label="Клієнт" name="subscriberId" required rules={[{ required: true, message: "Оберіть клієнта" }]}>
          <RemoteSelect
            name="subscribers"
            search={searchSubscribers}
            onChange={() => form.setFieldValue("payerId", undefined)}
          />
        </Form.Item>
      )}
      <Form.Item label="Назва" name="name" required rules={[zodRule(objectNameSchema)]}>
        <Input />
      </Form.Item>
      <Form.Item label="Статус" name="status" required initialValue="active">
        <DictSelect options={STATUS_OPTIONS} />
      </Form.Item>
      <PastDateField label="Статус діє з" name="statusFrom" />
      {status === "disconnected" && (
        <Form.Item
          label="Причина відключення"
          name="disconnectReasonId"
          required
          rules={[{ required: true, message: "Вкажіть причину відключення" }]}
        >
          <DictSelect options={reasons.options} isLoading={reasons.isLoading} hasError={reasons.hasError} />
        </Form.Item>
      )}
    </>
  );
}

function clientTariffText(client: SubscriberCard | undefined): string {
  const tariff = client?.tariffHistory[0];
  if (!client || !tariff) return "Об'єкт стане на тариф клієнта.";
  return `Тариф клієнта: ${tariff.tariffName}, сервер ${tariff.serverName}, програма ${client.programName}.`;
}

// П18: the tariff of the client unless the object has its own, of any program
export function ObjectTariffFields({ open, client }: { open: boolean; client: SubscriberCard | undefined }) {
  const form = Form.useFormInstance();
  const hasOwnTariff = Form.useWatch("hasOwnTariff", form) as boolean | undefined;
  return (
    <>
      <p className="form-note">{clientTariffText(client)}</p>
      <Form.Item name="hasOwnTariff" valuePropName="checked">
        <Checkbox>Свій тариф об'єкта</Checkbox>
      </Form.Item>
      {hasOwnTariff && <TariffFields open={open} dateName="ownTariffFrom" />}
    </>
  );
}

function refuseRepeatedAddon(_: unknown, rows: { addonId?: string }[] | undefined): Promise<void> {
  const chosen = (rows ?? []).flatMap(({ addonId }) => (addonId ? [addonId] : []));
  if (new Set(chosen).size === chosen.length) return Promise.resolve();
  return Promise.reject(new Error("Ця послуга вже є в списку"));
}

function AddonRows({ open, programId }: { open: boolean; programId: string | undefined }) {
  const form = Form.useFormInstance();
  const addons = useAddonOptions(programId, open);
  // П24: a service belongs to a program, so another program leaves nothing here that could stay. No program yet is not
  // another one: a person ticking a tariff of their own may stay in the same program.
  const lastProgramId = useRef(programId);
  useEffect(() => {
    if (!programId || programId === lastProgramId.current) return;
    if (lastProgramId.current) form.setFields([{ name: "addons", value: [], touched: false }]);
    lastProgramId.current = programId;
  }, [form, programId]);
  return (
    <Form.List name="addons" rules={[{ validator: refuseRepeatedAddon }]}>
      {(rows, { add, remove }, { errors }) => (
        <>
          {rows.map(({ key, name }) => (
            <div key={key} className="form-list-row">
              <Form.Item
                label="Послуга"
                name={[name, "addonId"]}
                required
                rules={[{ required: true, message: "Оберіть послугу" }]}
              >
                <DictSelect options={addons.options} isLoading={addons.isLoading} hasError={addons.hasError} />
              </Form.Item>
              <PastDateField label="Діє з" name={[name, "validFrom"]} />
              <Button
                className="form-list-row-action"
                type="text"
                icon={<DeleteOutlined />}
                aria-label="Прибрати послугу"
                onClick={() => remove(name)}
              />
            </div>
          ))}
          <Form.Item>
            <Button onClick={() => add()}>Додати послугу</Button>
            <Form.ErrorList errors={errors} />
          </Form.Item>
        </>
      )}
    </Form.List>
  );
}

function SensorRows() {
  return (
    <Form.List name="sensors">
      {(rows, { add, remove }) => (
        <>
          {rows.map(({ key, name }) => (
            <div key={key} className="form-list-row">
              <SensorChoiceField name={[name, "serialNo"]} />
              <PastDateField label="Встановлено" name={[name, "installedOn"]} />
              <Button
                className="form-list-row-action"
                type="text"
                icon={<DeleteOutlined />}
                aria-label="Прибрати датчик"
                onClick={() => remove(name)}
              />
            </div>
          ))}
          <Form.Item>
            <Button onClick={() => add()}>Додати датчик</Button>
          </Form.Item>
        </>
      )}
    </Form.List>
  );
}

export function ObjectExtraFields({ open, programId }: { open: boolean; programId: string | undefined }) {
  return (
    <>
      <AddonRows open={open} programId={programId} />
      <SensorRows />
      <Form.Item label="Примітка" name="note">
        <Input.TextArea rows={NOTE_ROWS} />
      </Form.Item>
    </>
  );
}
