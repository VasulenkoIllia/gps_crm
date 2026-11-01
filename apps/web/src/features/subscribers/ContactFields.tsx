import {
  CONTACT_CHANNELS,
  channelProblem,
  contactEmailSchema,
  contactNameSchema,
  phoneSchema,
  positionSchema,
  telegramChatIdSchema,
  viberChatIdSchema,
  type ContactChannel,
} from "@gps_crm/shared";
import { Form, Input, Radio } from "antd";
import type { RuleRender } from "antd/es/form";
import { zodRule } from "../../ui";

const CHANNEL_OPTIONS = Object.entries(CONTACT_CHANNELS).map(([value, label]) => ({ value, label }));

interface ChannelFieldsProps {
  prefix?: string[];
  initial?: { email?: string | null; telegramChatId?: string | null; viberChatId?: string | null };
}

interface ContactFieldsProps {
  // Under `contact` in the form of a new client, at the top of a form of a contact
  prefix?: string[];
  initial?: { fullName?: string; position?: string | null; phone?: string; channel?: ContactChannel | null };
}

// A rule that reads the form, because it runs on a change of the channel, before the render that would hand it a new one
function needsValueFor(channel: ContactChannel, channelField: string[]): RuleRender {
  return ({ getFieldValue }) => ({
    validator: (_, value: unknown) => {
      if (getFieldValue(channelField) !== channel || value) return Promise.resolve();
      return Promise.reject(new Error(channelProblem({ channel })?.message));
    },
  });
}

const CHANNEL_FIELDS = [
  {
    name: "telegramChatId",
    channel: "telegram",
    label: "Telegram Chat ID",
    schema: telegramChatIdSchema,
    type: "text",
  },
  { name: "viberChatId", channel: "viber", label: "Viber Chat ID", schema: viberChatIdSchema, type: "text" },
  { name: "email", channel: "email", label: "Email", schema: contactEmailSchema, type: "email" },
] as const;

export function ContactChannelFields({ prefix = [], initial }: ChannelFieldsProps) {
  const channelField = [...prefix, "channel"];
  const channel = Form.useWatch(channelField) as ContactChannel | undefined;
  return CHANNEL_FIELDS.map((field) => (
    <Form.Item
      key={field.name}
      label={field.label}
      name={[...prefix, field.name]}
      initialValue={initial?.[field.name] ?? undefined}
      required={channel === field.channel}
      dependencies={[channelField]}
      rules={[needsValueFor(field.channel, channelField), zodRule(field.schema.optional())]}
    >
      <Input type={field.type} autoComplete="off" />
    </Form.Item>
  ));
}

export function ContactMainFields({ prefix = [], initial }: ContactFieldsProps) {
  return (
    <>
      <Form.Item
        label="ПІБ"
        name={[...prefix, "fullName"]}
        required
        initialValue={initial?.fullName}
        rules={[zodRule(contactNameSchema)]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Посада"
        name={[...prefix, "position"]}
        initialValue={initial?.position ?? undefined}
        rules={[zodRule(positionSchema.optional())]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Телефон"
        name={[...prefix, "phone"]}
        required
        initialValue={initial?.phone}
        rules={[zodRule(phoneSchema)]}
      >
        <Input inputMode="tel" autoComplete="off" placeholder="+380 XX XXX XX XX" />
      </Form.Item>
      <Form.Item
        label="Канал повідомлень"
        name={[...prefix, "channel"]}
        required
        initialValue={initial?.channel ?? undefined}
        rules={[{ required: true, message: "Оберіть канал повідомлень" }]}
      >
        <Radio.Group options={CHANNEL_OPTIONS} />
      </Form.Item>
    </>
  );
}
