import { App, Checkbox, Form, Input, Modal, Radio, Select } from "antd";
import { useNavigate } from "react-router-dom";
import type { Channel, Contact, SubscriberType } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { USERS } from "../data/reference";
import { METHOD_OPTIONS } from "./PaymentModal";
import { CHANNEL_LABELS, Q, TYPE_OPTIONS } from "./ui";

const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));
const PHONE_RULE = { pattern: /^\+?[\d\s()-]{10,18}$/, message: "Формат: +380 50 123 45 67" };

/** Channel-specific identifier must be present for the chosen notification channel. */
const channelRules = (channel: Channel) => ({
  telegramChatId: channel === "telegram" ? [{ required: true, message: "Потрібен для Telegram" }] : [],
  viberChatId: channel === "viber" ? [{ required: true, message: "Потрібен для Viber" }] : [],
  email: [
    ...(channel === "email" ? [{ required: true, message: "Потрібен для Email" }] : []),
    { type: "email" as const, message: "Некоректний email" },
  ],
});

function ChannelFields() {
  const form = Form.useFormInstance();
  const channel: Channel = Form.useWatch("channel", form) ?? "telegram";
  const rules = channelRules(channel);
  return (
    <>
      <Form.Item name="channel" label={<>Канал повідомлень <Q id="5.5" /></>} rules={[{ required: true }]} initialValue="telegram">
        <Radio.Group options={CHANNEL_OPTIONS} optionType="button" />
      </Form.Item>
      <div className="grid grid-3" style={{ gap: 12 }}>
        <Form.Item name="telegramChatId" label={<>Telegram Chat ID <Q id="5.2" /></>} rules={rules.telegramChatId} extra="З CRM">
          <Input />
        </Form.Item>
        <Form.Item name="viberChatId" label="Viber Chat ID" rules={rules.viberChatId} extra="З CRM">
          <Input />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={rules.email}>
          <Input />
        </Form.Item>
      </div>
    </>
  );
}

interface NewSubscriberValues {
  type: SubscriberType;
  name: string;
  taxId?: string;
  crmUrl: string;
  managerId: string;
  paymentMethod: (typeof METHOD_OPTIONS)[number]["value"];
  note?: string;
  fullName: string;
  position?: string;
  phone: string;
  email?: string;
  telegramChatId?: string;
  viberChatId?: string;
  channel: Channel;
}

export function NewSubscriberModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, actions, currentUser } = useStore();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<NewSubscriberValues>();
  const type: SubscriberType = Form.useWatch("type", form) ?? "B2B";
  const nextCode = `AB-${String(data.seq.subscriber + 1).padStart(5, "0")}`;

  const submit = async () => {
    const v = await form.validateFields();
    const id = actions.addSubscriber({
      type: v.type, name: v.name.trim(), taxId: v.taxId?.trim(), crmUrl: v.crmUrl.trim(), managerId: v.managerId,
      paymentMethod: v.paymentMethod, note: v.note,
      contact: {
        fullName: v.type === "B2C" ? v.name.trim() : v.fullName.trim(), position: v.position, phone: v.phone,
        email: v.email || undefined, telegramChatId: v.telegramChatId || undefined, viberChatId: v.viberChatId || undefined,
        channel: v.channel,
      },
    });
    message.success(`Абонента ${nextCode} створено`);
    onClose();
    navigate(`/subscribers/${id}`);
  };

  const taxRules =
    type === "B2C"
      ? [{ pattern: /^\d{10}$/, message: "ІПН — 10 цифр" }]
      : [
          { required: true, message: "Обов'язково для юросіб" },
          { pattern: /^(\d{8}|\d{10})$/, message: "ЄДРПОУ — 8 цифр, ІПН (ФОП) — 10 цифр" },
        ];

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} okText="Створити" cancelText="Скасувати" title="Новий абонент" width={760} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
       
        preserve={false}
        initialValues={{
          type: "B2B",
          managerId: currentUser.role === "manager" ? currentUser.id : "u-m1",
          paymentMethod: "invoice",
          channel: "telegram",
        }}
      >
        <div className="group-label">
          ID буде присвоєно автоматично: <b>{nextCode}</b> <Q id="4.3" />
        </div>
        <Form.Item name="type" label="Тип абонента" rules={[{ required: true }]}>
          <Radio.Group options={TYPE_OPTIONS} />
        </Form.Item>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Form.Item
            name="name"
            label={type === "B2C" ? "ПІБ" : "Повна назва компанії"}
            rules={[{ required: true, message: "Обов'язкове поле" }]}
          >
            <Input placeholder={type === "B2C" ? "Прізвище Ім'я По батькові" : "ТОВ «Назва»"} />
          </Form.Item>
          <Form.Item name="taxId" label={type === "B2C" ? "ІПН (необов'язково)" : "ЄДРПОУ / ІПН"} rules={taxRules}>
            <Input inputMode="numeric" />
          </Form.Item>
          <Form.Item name="crmUrl" label={<>Посилання на CRM <Q id="5.1" /></>} rules={[{ required: true, message: "Обов'язкове поле" }, { type: "url", message: "Некоректне посилання" }]}>
            <Input placeholder="https://crm…" />
          </Form.Item>
          <Form.Item name="managerId" label={<>Відповідальний менеджер <Q id="4.4" /></>} rules={[{ required: true }]}>
            <Select options={USERS.filter((u) => u.role === "manager").map((u) => ({ value: u.id, label: u.name }))} />
          </Form.Item>
          <Form.Item name="paymentMethod" label={<>Форма оплати <Q id="1.7" /></>} rules={[{ required: true }]}>
            <Select options={METHOD_OPTIONS} />
          </Form.Item>
        </div>

        <div className="group-label">Основна контактна особа</div>
        {type !== "B2C" && (
          <div className="grid grid-2" style={{ gap: 12 }}>
            <Form.Item name="fullName" label="ПІБ" rules={[{ required: true, message: "Обов'язкове поле" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="position" label="Посада">
              <Input />
            </Form.Item>
          </div>
        )}
        <Form.Item name="phone" label="Телефон" rules={[{ required: true, message: "Обов'язкове поле" }, PHONE_RULE]}>
          <Input placeholder="+380 50 123 45 67" style={{ maxWidth: 260 }} />
        </Form.Item>
        <ChannelFields />
        <Form.Item name="note" label="Примітка">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

type ContactValues = Omit<Contact, "id" | "subscriberId" | "active" | "crmUrl"> & { crmUrl: string };

export function ContactModal({ open, onClose, subscriberId }: { open: boolean; onClose: () => void; subscriberId: string }) {
  const { actions } = useStore();
  const { message } = App.useApp();
  const [form] = Form.useForm<ContactValues>();

  const submit = async () => {
    const v = await form.validateFields();
    actions.addContact(subscriberId, {
      ...v,
      email: v.email || undefined,
      telegramChatId: v.telegramChatId || undefined,
      viberChatId: v.viberChatId || undefined,
      active: true,
    });
    message.success("Контакт додано");
    onClose();
  };

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} okText="Додати" cancelText="Скасувати" title="Нова контактна особа" width={720} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
       
        preserve={false}
        initialValues={{ channel: "telegram", isPrimary: false, billingNotify: true, techNotify: false }}
      >
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Form.Item name="fullName" label="ПІБ" rules={[{ required: true, message: "Обов'язкове поле" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position" label="Посада">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Телефон" rules={[{ required: true, message: "Обов'язкове поле" }, PHONE_RULE]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone2" label="Додатковий телефон" rules={[PHONE_RULE]}>
            <Input />
          </Form.Item>
        </div>
        <ChannelFields />
        <Form.Item name="crmUrl" label="Посилання на CRM" rules={[{ required: true, message: "Обов'язкове поле" }, { type: "url", message: "Некоректне посилання" }]}>
          <Input placeholder="https://crm…" />
        </Form.Item>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <Form.Item name="isPrimary" valuePropName="checked" noStyle>
            <Checkbox>Основна контактна особа</Checkbox>
          </Form.Item>
          <Form.Item name="billingNotify" valuePropName="checked" noStyle>
            <Checkbox>Отримує повідомлення про оплату / борг</Checkbox>
          </Form.Item>
          <Form.Item name="techNotify" valuePropName="checked" noStyle>
            <Checkbox>Отримує технічні повідомлення</Checkbox>
          </Form.Item>
        </div>
        <Form.Item name="note" label="Примітка" style={{ marginTop: 16 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
