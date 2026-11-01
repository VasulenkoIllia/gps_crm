import {
  seriesNameSchema,
  seriesNumberSchema,
  SUBSCRIBER_TYPES,
  type IdSeries,
  type SubscriberType,
} from "@gps_crm/shared";
import { Alert, Form, Input, InputNumber } from "antd";
import { DictSelect, FormModal, zodRule } from "../../ui";
import { useReferenceSave } from "../references/reference-form";
import { refreshClients } from "../subscribers/subscribers.api";
import { createIdSeries, updateIdSeries } from "./id-series.api";

const TYPE_OPTIONS = Object.entries(SUBSCRIBER_TYPES).map(([value, label]) => ({ value, label, isActive: true }));

interface SeriesValues {
  name: string;
  types: SubscriberType[];
  rangeFrom: number;
  rangeTo: number;
  nextNumber: number;
}

interface NumberFieldProps {
  label: string;
  name: "rangeFrom" | "rangeTo" | "nextNumber";
  initialValue: number | undefined;
}

function NumberField({ label, name, initialValue }: NumberFieldProps) {
  return (
    <Form.Item label={label} name={name} required initialValue={initialValue} rules={[zodRule(seriesNumberSchema)]}>
      <InputNumber precision={0} className="form-number" />
    </Form.Item>
  );
}

// D62: a type named here moves over from the series that held it, so the form says it before the save does it
function movedTypes(chosen: SubscriberType[] | undefined, others: IdSeries[]): string[] {
  return (chosen ?? []).flatMap((type) => {
    const holder = others.find((series) => series.types.includes(type));
    return holder ? [`${SUBSCRIBER_TYPES[type]} перейде із серії «${holder.name}»`] : [];
  });
}

interface IdSeriesFormProps {
  row: IdSeries | null;
  all: IdSeries[];
  open: boolean;
  onClose: () => void;
}

export function IdSeriesForm({ row, all, open, onClose }: IdSeriesFormProps) {
  const [form] = Form.useForm<SeriesValues>();
  const chosen = Form.useWatch("types", form);
  const moved = movedTypes(
    chosen,
    all.filter((series) => series.id !== row?.id),
  );
  const save = useReferenceSave((input: object) => (row ? updateIdSeries(row.id, input) : createIdSeries(input)), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : "Нова серія"}
      open={open}
      onSubmit={(values) => save.submit(row ? { ...values, version: row.version } : values)}
    >
      <Form.Item label="Назва" name="name" required initialValue={row?.name} rules={[zodRule(seriesNameSchema)]}>
        <Input autoComplete="off" autoFocus />
      </Form.Item>
      <Form.Item label="Типи клієнтів" name="types" initialValue={row?.types ?? []}>
        <DictSelect<SubscriberType[]> isMultiple options={TYPE_OPTIONS} />
      </Form.Item>
      {moved.length > 0 && <Alert type="warning" showIcon className="form-alert" title={moved.join(". ")} />}
      <NumberField label="Від" name="rangeFrom" initialValue={row?.rangeFrom} />
      <NumberField label="До" name="rangeTo" initialValue={row?.rangeTo} />
      <NumberField label="Наступний номер" name="nextNumber" initialValue={row?.nextNumber} />
    </FormModal>
  );
}
