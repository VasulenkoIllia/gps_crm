import {
  detailsContactSchema,
  legalNameSchema,
  PAYMENT_METHODS,
  paymentProblems,
  vchasnoEmailSchema,
  type PaymentFields,
  type PaymentMethod,
} from "@gps_crm/shared";
import { Form, Input, type FormInstance } from "antd";
import { DictSelect, zodRule } from "../../ui";

const METHOD_OPTIONS = Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label, isActive: true }));

interface PayerFieldsProps {
  prefix?: string[];
  initial?: {
    paymentMethod?: PaymentMethod;
    legalName?: string | null;
    vchasnoEmail?: string | null;
    detailsContact?: string | null;
    paymentTermsNote?: string | null;
  };
}

function needs(method: PaymentMethod | undefined, field: keyof PaymentFields) {
  return method ? paymentProblems({ paymentMethod: method }).find((problem) => problem.field === field) : undefined;
}

// The tax number stands apart from the fields of a form of payment, and some of them cannot go without it (П8)
export function usePaymentTaxId(name: string | string[], form?: FormInstance) {
  return needs(Form.useWatch(name, form) as PaymentMethod | undefined, "taxId");
}

// П8: only the fields of the chosen form of payment
export function PayerMethodFields({ prefix = [], initial }: PayerFieldsProps) {
  const method = Form.useWatch([...prefix, "paymentMethod"]) as PaymentMethod | undefined;
  const legalName = needs(method, "legalName");
  const vchasnoEmail = needs(method, "vchasnoEmail");
  const detailsContact = needs(method, "detailsContact");
  return (
    <>
      <Form.Item
        label="Форма оплати"
        name={[...prefix, "paymentMethod"]}
        required
        initialValue={initial?.paymentMethod}
        rules={[{ required: true, message: "Оберіть форму оплати" }]}
      >
        <DictSelect options={METHOD_OPTIONS} />
      </Form.Item>
      {legalName && (
        <Form.Item
          label="Повна назва юрособи"
          name={[...prefix, "legalName"]}
          required
          initialValue={initial?.legalName ?? undefined}
          rules={[{ required: true, whitespace: true, message: legalName.message }, zodRule(legalNameSchema)]}
        >
          <Input autoComplete="off" />
        </Form.Item>
      )}
      {vchasnoEmail && (
        <Form.Item
          label="Пошта для «Вчасно»"
          name={[...prefix, "vchasnoEmail"]}
          required
          initialValue={initial?.vchasnoEmail ?? undefined}
          rules={[{ required: true, message: vchasnoEmail.message }, zodRule(vchasnoEmailSchema)]}
        >
          <Input type="email" autoComplete="off" />
        </Form.Item>
      )}
      {detailsContact && (
        <Form.Item
          label="Куди надсилати реквізити: телефон або пошта"
          name={[...prefix, "detailsContact"]}
          required
          initialValue={initial?.detailsContact ?? undefined}
          rules={[{ required: true, message: detailsContact.message }, zodRule(detailsContactSchema)]}
        >
          <Input autoComplete="off" />
        </Form.Item>
      )}
      <Form.Item
        label="Умови оплати"
        name={[...prefix, "paymentTermsNote"]}
        initialValue={initial?.paymentTermsNote ?? undefined}
      >
        <Input autoComplete="off" placeholder="Наприклад, не пізніше 10-го числа" />
      </Form.Item>
    </>
  );
}
