import { crmUrlSchema, noteTextSchema, secondPhoneSchema, type Contact } from "@gps_crm/shared";
import { Checkbox, Form, Input } from "antd";
import { FormDrawer, zodRule } from "../../ui";
import { useReferenceSave } from "../references/reference-form";
import { ContactChannelFields, ContactMainFields } from "./ContactFields";
import { createContact, refreshClients, updateContact } from "./subscribers.api";

interface ContactValues {
  fullName: string;
  phone: string;
  channel: string;
  crmUrl: string;
  isPrimary: boolean;
  billingNotify: boolean;
  techNotify: boolean;
  isActive: boolean;
  position?: string;
  phone2?: string;
  email?: string;
  telegramChatId?: string;
  viberChatId?: string;
  note?: string;
}

// A change carries the whole record (D59), and a field never touched comes out of the form as undefined
function wholeRecord(values: ContactValues) {
  return {
    ...values,
    position: values.position || null,
    phone2: values.phone2 || null,
    email: values.email || null,
    telegramChatId: values.telegramChatId || null,
    viberChatId: values.viberChatId || null,
    note: values.note || null,
  };
}

interface ContactFormProps {
  subscriberId: string;
  clientCrmUrl: string | null;
  row: Contact | null;
  open: boolean;
  onClose: () => void;
}

export function ContactForm({ subscriberId, clientCrmUrl, row, open, onClose }: ContactFormProps) {
  const [form] = Form.useForm<ContactValues>();
  const save = useReferenceSave(
    (input: object) => (row ? updateContact(row.id, input) : createContact(subscriberId, input)),
    { form, refresh: refreshClients, onDone: onClose },
  );

  return (
    <FormDrawer
      {...save.modal}
      title={row ? `Змінити: ${row.fullName}` : "Додати контакт"}
      open={open}
      onSubmit={(values) => save.submit(row ? { ...wholeRecord(values), version: row.version } : wholeRecord(values))}
    >
      <ContactMainFields initial={row ?? undefined} />
      <Form.Item
        label="Додатковий телефон"
        name="phone2"
        initialValue={row?.phone2 ?? undefined}
        rules={[zodRule(secondPhoneSchema.optional())]}
      >
        <Input inputMode="tel" autoComplete="off" />
      </Form.Item>
      <ContactChannelFields initial={row ?? undefined} />
      <Form.Item
        label="Посилання на CRM"
        name="crmUrl"
        required
        initialValue={row?.crmUrl ?? clientCrmUrl ?? undefined}
        rules={[zodRule(crmUrlSchema)]}
      >
        <Input autoComplete="off" placeholder="https://" />
      </Form.Item>
      <Form.Item name="isPrimary" valuePropName="checked" initialValue={row?.isPrimary ?? false}>
        <Checkbox>Основна особа</Checkbox>
      </Form.Item>
      <Form.Item name="billingNotify" valuePropName="checked" initialValue={row?.billingNotify ?? true}>
        <Checkbox>Отримує повідомлення про оплату</Checkbox>
      </Form.Item>
      <Form.Item name="techNotify" valuePropName="checked" initialValue={row?.techNotify ?? true}>
        <Checkbox>Отримує технічні повідомлення</Checkbox>
      </Form.Item>
      <Form.Item name="isActive" valuePropName="checked" initialValue={row?.isActive ?? true}>
        <Checkbox>Активна</Checkbox>
      </Form.Item>
      <Form.Item
        label="Примітка"
        name="note"
        initialValue={row?.note ?? undefined}
        rules={[zodRule(noteTextSchema.optional())]}
      >
        <Input.TextArea autoSize={{ minRows: 2 }} />
      </Form.Item>
    </FormDrawer>
  );
}
