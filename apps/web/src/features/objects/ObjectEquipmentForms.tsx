import { OLD_DEVICE_STATES, type ObjectCard, type OldDeviceState } from "@gps_crm/shared";
import { Checkbox, Form, Radio } from "antd";
import { FormModal } from "../../ui";
import {
  ContractorField,
  DeviceChoiceFields,
  PastDateField,
  SensorChoiceField,
  SimChoiceFields,
} from "../equipment/EquipmentFields";
import { useRecordSave } from "../references/reference-form";
import { refreshClients } from "../subscribers/subscribers.api";
import type { ObjectFormProps } from "./ObjectForms";
import { objectAction, removeObjectSensor } from "./objects.api";

const OLD_STATE_OPTIONS = Object.entries(OLD_DEVICE_STATES).map(([value, label]) => ({ value, label }));

interface ReplaceDeviceValues {
  device: object;
  installedOn: string;
  contractorId?: string;
  oldState?: OldDeviceState;
  moveSim?: boolean;
  sim?: object;
}

// П14: the history stays where it is, and only what stands on the object now changes
export function ReplaceDeviceModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<ReplaceDeviceValues>();
  const moveSim = Form.useWatch("moveSim", form);
  const hasOldSim = card.sim !== null;
  const isMoving = hasOldSim && moveSim !== false;
  const save = useRecordSave((input: object) => objectAction(card.id, "replace-device", input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal
      {...save.modal}
      title={card.device ? "Замінити трекер" : "Встановити трекер"}
      open={open}
      onSubmit={(values) => save.submit({ ...values, moveSim: isMoving }, false)}
    >
      <DeviceChoiceFields open={open} />
      <PastDateField label="Дата встановлення" name="installedOn" />
      <ContractorField open={open} />
      {card.device && (
        <Form.Item label="Що зі старим трекером" name="oldState" initialValue="removed">
          <Radio.Group options={OLD_STATE_OPTIONS} optionType="button" />
        </Form.Item>
      )}
      {hasOldSim && (
        <Form.Item name="moveSim" valuePropName="checked" initialValue>
          <Checkbox>Перенести SIM у новий трекер</Checkbox>
        </Form.Item>
      )}
      {!isMoving && <SimChoiceFields open={open} />}
    </FormModal>
  );
}

interface ReplaceSimValues {
  sim: object;
  installedOn: string;
  contractorId?: string;
}

export function ReplaceSimModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<ReplaceSimValues>();
  const save = useRecordSave((input: object) => objectAction(card.id, "replace-sim", input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal {...save.modal} title="Замінити SIM" open={open} onSubmit={(values) => save.submit(values, false)}>
      <SimChoiceFields open={open} />
      <PastDateField label="Дата встановлення" name="installedOn" />
      <ContractorField open={open} />
    </FormModal>
  );
}

interface SensorValues {
  serialNo: string;
  installedOn: string;
  contractorId?: string;
}

export function AddSensorModal({ card, open, onClose }: ObjectFormProps) {
  const [form] = Form.useForm<SensorValues>();
  const save = useRecordSave((input: object) => objectAction(card.id, "sensors", input), {
    form,
    renamed: { "sensor.serialNo": "serialNo" },
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal
      {...save.modal}
      title="Додати датчик"
      open={open}
      onSubmit={({ serialNo, ...values }) => save.submit({ ...values, sensor: { serialNo } }, false)}
    >
      <SensorChoiceField name={["serialNo"]} />
      <PastDateField label="Дата встановлення" name="installedOn" />
      <ContractorField open={open} />
    </FormModal>
  );
}

interface RemoveSensorModalProps extends Pick<ObjectFormProps, "open" | "onClose"> {
  objectId: ObjectCard["id"];
  sensor: ObjectCard["sensors"][number] | null;
}

export function RemoveSensorModal({ objectId, sensor, open, onClose }: RemoveSensorModalProps) {
  const [form] = Form.useForm<{ removedOn: string }>();
  const save = useRecordSave((input: object) => removeObjectSensor(objectId, sensor?.id ?? "", input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  return (
    <FormModal
      {...save.modal}
      title={`Зняти датчик ${sensor?.serialNo ?? ""}`}
      open={open}
      onSubmit={(values) => save.submit(values, false)}
    >
      <PastDateField label="Дата зняття" name="removedOn" />
    </FormModal>
  );
}
