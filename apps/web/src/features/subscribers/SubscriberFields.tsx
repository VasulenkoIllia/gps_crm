import {
  crmUrlSchema,
  discountTextSchema,
  graceDaysSchema,
  legacyCodeSchema,
  noteTextSchema,
  payerTaxIdSchema,
  SUBSCRIBER_TYPES,
  subscriberNameSchema,
  type SubscriberType,
} from "@gps_crm/shared";
import { Form, Input, InputNumber } from "antd";
import { DictSelect, MoneyInput, zodRule } from "../../ui";
import { usePaymentTaxId } from "./PayerFields";

const TYPE_OPTIONS = Object.entries(SUBSCRIBER_TYPES).map(([value, label]) => ({ value, label, isActive: true }));
const TAX_ID_REQUIRED = "Вкажіть ЄДРПОУ або ІПН";

export interface SubscriberValues {
  type: SubscriberType;
  name: string;
  taxId?: string;
  crmUrl: string;
  managerId: string;
  graceDays: number;
  discount: string;
  legacyCode?: string;
  note?: string;
}

interface SubscriberFieldsProps {
  managers: { options: { value: string; label: string; isActive: boolean }[]; isLoading: boolean; hasError: boolean };
  initial?: Partial<Omit<SubscriberValues, "taxId" | "crmUrl" | "legacyCode" | "note">> & {
    taxId?: string | null;
    crmUrl?: string | null;
    legacyCode?: string | null;
    note?: string | null;
  };
}

export function SubscriberFields({ managers, initial }: SubscriberFieldsProps) {
  const type = Form.useWatch("type") as SubscriberType | undefined;
  const paymentTaxId = usePaymentTaxId(["payer", "paymentMethod"]);
  const isTaxIdRequired = (type !== undefined && type !== "B2C") || paymentTaxId !== undefined;
  return (
    <>
      <Form.Item
        label="Тип клієнта"
        name="type"
        required
        initialValue={initial?.type}
        rules={[{ required: true, message: "Оберіть тип клієнта" }]}
      >
        <DictSelect options={TYPE_OPTIONS} />
      </Form.Item>
      <Form.Item
        label="Назва або ПІБ"
        name="name"
        required
        initialValue={initial?.name}
        rules={[zodRule(subscriberNameSchema)]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="ЄДРПОУ / ІПН"
        name="taxId"
        required={isTaxIdRequired}
        initialValue={initial?.taxId ?? undefined}
        rules={[{ required: isTaxIdRequired, message: TAX_ID_REQUIRED }, zodRule(payerTaxIdSchema.optional())]}
      >
        <Input inputMode="numeric" autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Посилання на CRM"
        name="crmUrl"
        required
        initialValue={initial?.crmUrl ?? undefined}
        rules={[zodRule(crmUrlSchema)]}
      >
        <Input autoComplete="off" placeholder="https://" />
      </Form.Item>
      <Form.Item
        label="Менеджер"
        name="managerId"
        required
        initialValue={initial?.managerId}
        rules={[{ required: true, message: "Оберіть менеджера" }]}
      >
        <DictSelect options={managers.options} isLoading={managers.isLoading} hasError={managers.hasError} />
      </Form.Item>
      <Form.Item
        label="Відстрочка оплати, днів"
        name="graceDays"
        required
        extra="0 означає передплату"
        initialValue={initial?.graceDays ?? 0}
        rules={[zodRule(graceDaysSchema)]}
      >
        <InputNumber min={0} precision={0} className="form-number" />
      </Form.Item>
      <Form.Item
        label="Знижка"
        name="discount"
        required
        extra="Діє на всі об'єкти клієнта. 0 означає без знижки"
        initialValue={initial?.discount ?? "0"}
        rules={[zodRule(discountTextSchema)]}
      >
        <MoneyInput />
      </Form.Item>
      <Form.Item
        label="Старий номер"
        name="legacyCode"
        initialValue={initial?.legacyCode ?? undefined}
        rules={[zodRule(legacyCodeSchema.optional())]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Примітка"
        name="note"
        initialValue={initial?.note ?? undefined}
        rules={[zodRule(noteTextSchema.optional())]}
      >
        <Input.TextArea autoSize={{ minRows: 2 }} />
      </Form.Item>
    </>
  );
}
