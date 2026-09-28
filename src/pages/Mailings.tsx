import { useMemo, useState } from "react";
import { App, Button, Checkbox, DatePicker, Empty, Form, Input, Modal, Radio, Result, Select, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import { EditOutlined, LeftOutlined, PlusOutlined, RightOutlined, SendOutlined, WarningOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import type { Channel, Contact, MessageTemplate, Subscriber, SubscriberStatus, SubscriberType, TemplateKind } from "../domain/types";
import { useStore, type Index } from "../store/DemoStore";
import { objectPrice } from "../domain/billing";
import { PROGRAMS, USER_BY_ID } from "../data/reference";
import { COMPANY_REQUISITES } from "../data/seed";
import { fmtDate, fmtDateTime, fmtNum } from "../components/format";
import { CHANNEL_LABELS, ChannelTag, Kpi, PageTitle, Section, STATUS_LABELS } from "../components/ui";

const KIND_LABELS: Record<TemplateKind, string> = {
  reminder: "Нагадування про оплату",
  debt: "Заборгованість",
  invoice: "Рахунок / реквізити",
  info: "Інформаційне",
  tech: "Технічне",
};

const VARIABLES: { key: string; label: string }[] = [
  { key: "name", label: "Ім'я контакту" },
  { key: "company", label: "Абонент" },
  { key: "code", label: "ID абонента" },
  { key: "objects", label: "К-сть об'єктів" },
  { key: "amount", label: "Сума / міс" },
  { key: "debt", label: "Борг" },
  { key: "paid_until", label: "Оплачено до" },
  { key: "requisites", label: "Реквізити" },
  { key: "manager", label: "Менеджер" },
];

type Audience = "billing" | "tech" | "all";

interface Recipient {
  key: string;
  contact: Contact;
  subscriber: Subscriber;
  channel: Channel;
  deliverable: boolean;
  viaFallback: boolean;
  vars: Record<string, string>;
}

const render = (body: string, vars: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);

function variablesFor(sub: Subscriber, contact: Contact, index: Index, today: Dayjs): Record<string, string> {
  const live = (index.objectsBySubscriber[sub.id] ?? []).filter((o) => o.status !== "disconnected");
  const paidUntil = live.map((o) => o.paidUntil).sort()[0];
  const [, first = "", patr = ""] = contact.fullName.split(" ");
  const sum = index.summaries[sub.id];
  return {
    name: `${first} ${patr}`.trim(),
    company: sub.name,
    code: sub.code,
    objects: String(live.length),
    amount: fmtNum(live.reduce((s, o) => s + objectPrice(o).total, 0)),
    debt: fmtNum(sum.debt),
    paid_until: paidUntil ? fmtDate(paidUntil) : "-",
    requisites: COMPANY_REQUISITES,
    manager: USER_BY_ID[sub.managerId]?.name ?? "",
    today: today.format("DD.MM.YYYY"),
  };
}

function isDeliverable(c: Contact, channel: Channel) {
  return channel === "telegram" ? !!c.telegramChatId : channel === "viber" ? !!c.viberChatId : !!c.email;
}

export default function Mailings() {
  const { can } = useStore();
  if (!can("mailings.send")) {
    return <Result status="403" title="Немає доступу" subTitle="Розсилки недоступні для вашої ролі." />;
  }
  return (
    <>
      <PageTitle title="Розсилки та сповіщення">
        Етап 2: Email, Telegram-бот, Viber-бот. У демо повідомлення реально не надсилаються.
      </PageTitle>
      <div className="panel" style={{ padding: "4px 16px 16px" }}>
        <Tabs
          items={[
            { key: "new", label: "Нова розсилка", children: <NewMailing /> },
            { key: "templates", label: "Шаблони", children: <Templates /> },
            { key: "auto", label: "Автоматичні сценарії", children: <AutoRules /> },
            { key: "history", label: "Історія", children: <History /> },
          ]}
        />
      </div>
    </>
  );
}

function NewMailing() {
  const { data, index, today, can, isVisible, actions } = useStore();
  const { message, modal } = App.useApp();
  const [templateId, setTemplateId] = useState("t-reminder");
  const [statuses, setStatuses] = useState<SubscriberStatus[]>(["active", "partial"]);
  const [types, setTypes] = useState<SubscriberType[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [debtOnly, setDebtOnly] = useState(false);
  const [paidBefore, setPaidBefore] = useState<Dayjs | null>(null);
  const [audience, setAudience] = useState<Audience>("billing");
  const [channelMode, setChannelMode] = useState<"preferred" | Channel>("preferred");
  const [fallback, setFallback] = useState(true);
  const [previewIdx, setPreviewIdx] = useState(0);
  const template = index.templateById[templateId];

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    setPreviewIdx(0);
    const kind = index.templateById[id]?.kind;
    if (kind === "debt") {
      setDebtOnly(true);
      setAudience("billing");
    } else if (kind === "tech") {
      setDebtOnly(false);
      setAudience("tech");
    } else {
      setDebtOnly(false);
      setAudience("billing");
    }
  };

  const recipients = useMemo(() => {
    const out: Recipient[] = [];
    for (const sub of data.subscribers) {
      const sum = index.summaries[sub.id];
      if (!isVisible(sub)) continue;
      if (statuses.length && !statuses.includes(sum.status)) continue;
      if (types.length && !types.includes(sub.type)) continue;
      if (programs.length && !sum.programIds.some((p) => programs.includes(p))) continue;
      if (debtOnly && sum.debt <= 0) continue;
      if (paidBefore) {
        const live = (index.objectsBySubscriber[sub.id] ?? []).filter((o) => o.status !== "disconnected");
        if (!live.some((o) => !dayjs(o.paidUntil).isAfter(paidBefore, "day"))) continue;
      }
      for (const c of index.contactsBySubscriber[sub.id] ?? []) {
        if (!c.active) continue;
        if (audience === "billing" && !c.billingNotify) continue;
        if (audience === "tech" && !c.techNotify) continue;
        let channel: Channel = channelMode === "preferred" ? c.channel : channelMode;
        let deliverable = isDeliverable(c, channel);
        let viaFallback = false;
        if (!deliverable && fallback && channel !== "email" && c.email) {
          channel = "email";
          deliverable = true;
          viaFallback = true;
        }
        out.push({ key: c.id, contact: c, subscriber: sub, channel, deliverable, viaFallback, vars: variablesFor(sub, c, index, today) });
      }
    }
    return out;
  }, [data.subscribers, index, isVisible, statuses, types, programs, debtOnly, paidBefore, audience, channelMode, fallback, today]);

  const ok = recipients.filter((r) => r.deliverable);
  const skipped = recipients.length - ok.length;
  const byChannel = { telegram: 0, viber: 0, email: 0 } as Record<Channel, number>;
  ok.forEach((r) => (byChannel[r.channel] += 1));
  const subsCount = new Set(recipients.map((r) => r.subscriber.id)).size;
  const preview = ok[Math.min(previewIdx, Math.max(0, ok.length - 1))];

  const audienceText = [
    statuses.length ? statuses.map((s) => STATUS_LABELS[s]).join(", ") : "Усі статуси",
    types.length ? types.join("/") : null,
    programs.length ? programs.map((p) => PROGRAMS.find((x) => x.id === p)?.name).join(", ") : null,
    debtOnly ? "з боргом" : null,
    paidBefore ? `оплата до ${paidBefore.format("DD.MM")}` : null,
  ].filter(Boolean).join(" · ");

  const send = () => {
    if (!ok.length) return void message.warning("Немає отримувачів, яким можна доставити повідомлення");
    modal.confirm({
      title: `Надіслати «${template?.name}»?`,
      content: `${ok.length} повідомлень: Telegram ${byChannel.telegram}, Viber ${byChannel.viber}, Email ${byChannel.email}.${skipped ? ` Не буде доставлено: ${skipped}.` : ""}`,
      okText: "Надіслати",
      cancelText: "Скасувати",
      onOk: () => {
        actions.sendMailing({ templateId, audience: audienceText, byChannel, skipped });
        message.success("Демо: розсилку зафіксовано в історії, реальні повідомлення не надсилались");
      },
    });
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="grid">
        <Section title="Що надсилаємо">
          <Form layout="vertical">
            <Form.Item label="Шаблон" style={{ marginBottom: 12 }}>
              <Select value={templateId} onChange={pickTemplate} options={data.templates.map((t) => ({ value: t.id, label: t.name }))} />
            </Form.Item>
            <Form.Item label="Кому з контактів" style={{ marginBottom: 12 }}>
              <Radio.Group
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                options={[
                  { value: "billing", label: "Отримують повідомлення про оплату" },
                  { value: "tech", label: "Отримують технічні" },
                  { value: "all", label: "Усім активним" },
                ]}
              />
            </Form.Item>
            <Form.Item label="Канал" style={{ marginBottom: 8 }}>
              <Radio.Group
                value={channelMode}
                onChange={(e) => setChannelMode(e.target.value)}
                optionType="button"
                options={[
                  { value: "preferred", label: "Основний канал контакту" },
                  { value: "telegram", label: "Telegram" },
                  { value: "viber", label: "Viber" },
                  { value: "email", label: "Email" },
                ]}
              />
            </Form.Item>
            <Checkbox checked={fallback} onChange={(e) => setFallback(e.target.checked)}>
              Якщо канал недоступний, надіслати на Email
            </Checkbox>
          </Form>
        </Section>
        <Section title="Фільтр абонентів">
          <Form layout="vertical">
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Form.Item label="Статус абонента" style={{ marginBottom: 0 }}>
                <Select mode="multiple" allowClear placeholder="Усі" value={statuses} onChange={setStatuses} options={(Object.keys(STATUS_LABELS) as SubscriberStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
              </Form.Item>
              <Form.Item label="Тип абонента" style={{ marginBottom: 0 }}>
                <Select mode="multiple" allowClear placeholder="Усі" value={types} onChange={setTypes} options={["B2B", "B2C", "B2G"].map((t) => ({ value: t, label: t }))} />
              </Form.Item>
              <Form.Item label="Програма" style={{ marginBottom: 0 }}>
                <Select mode="multiple" allowClear placeholder="Усі" value={programs} onChange={setPrograms} options={PROGRAMS.map((p) => ({ value: p.id, label: p.name }))} />
              </Form.Item>
              <Form.Item label="Оплачено до (включно)" style={{ marginBottom: 0 }}>
                <DatePicker value={paidBefore} onChange={setPaidBefore} format="DD.MM.YYYY" style={{ width: "100%" }} placeholder="Будь-яка дата" />
              </Form.Item>
            </div>
            {can("finance.view") && (
              <Checkbox checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} style={{ marginTop: 12 }}>
                Лише абоненти з боргом
              </Checkbox>
            )}
          </Form>
        </Section>
        <ChannelsSetup />
      </div>

      <div className="grid">
        <div className="kpi-row" style={{ marginBottom: 0 }}>
          <Kpi label="Абонентів" value={subsCount} />
          <Kpi label="Повідомлень" value={ok.length} hint={`Telegram ${byChannel.telegram} · Viber ${byChannel.viber} · Email ${byChannel.email}`} />
          <Kpi
            label="Не буде доставлено"
            value={<span className={skipped ? "debt" : undefined}>{skipped}</span>}
            hint="немає Chat ID / email для каналу"
          />
        </div>
        <Section
          title="Попередній перегляд"
          extra={
            ok.length > 1 && (
              <span className="secondary" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Button size="small" type="text" icon={<LeftOutlined />} aria-label="Попередній" onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))} />
                {Math.min(previewIdx, ok.length - 1) + 1} / {ok.length}
                <Button size="small" type="text" icon={<RightOutlined />} aria-label="Наступний" onClick={() => setPreviewIdx((i) => Math.min(ok.length - 1, i + 1))} />
              </span>
            )
          }
        >
          {preview && template ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <ChannelTag channel={preview.channel} />
                {preview.viaFallback && <Tag color="warning">резервний канал</Tag>}
                <span>{preview.contact.fullName}</span>
                <span className="muted">· {preview.subscriber.name}</span>
              </div>
              {preview.channel === "email" && template.subject && (
                <div className="secondary" style={{ marginBottom: 6 }}>
                  Тема: <b>{template.subject}</b>
                </div>
              )}
              <div className="preview-message">{render(template.body, preview.vars)}</div>
            </>
          ) : (
            <Empty description="Немає отримувачів за цими фільтрами" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Section>
        <Section title={`Отримувачі (${recipients.length})`}>
          <Table<Recipient>
            size="small"
            rowKey="key"
            dataSource={recipients}
            pagination={{ pageSize: 8, showSizeChanger: false, size: "small" }}
            scroll={{ x: 480 }}
            columns={[
              { title: "Контакт", render: (_, r) => <div>{r.contact.fullName}<div className="muted" style={{ fontSize: 12 }}>{r.subscriber.name}</div></div> },
              { title: "Канал", render: (_, r) => <ChannelTag channel={r.channel} /> },
              {
                title: "Доставка",
                render: (_, r) =>
                  r.deliverable ? (
                    r.viaFallback ? <Tag color="warning">через Email</Tag> : <Tag color="success">так</Tag>
                  ) : (
                    <Tooltip title={`Немає ${r.channel === "email" ? "email" : "Chat ID"} для каналу ${CHANNEL_LABELS[r.channel]}`}>
                      <Tag color="error" icon={<WarningOutlined />}>ні</Tag>
                    </Tooltip>
                  ),
              },
            ]}
          />
          {can("mailings.send") ? (
            <Button type="primary" icon={<SendOutlined />} onClick={send} style={{ marginTop: 12 }} disabled={!ok.length}>
              Надіслати ({ok.length})
            </Button>
          ) : (
            <div className="muted" style={{ marginTop: 12 }}>Ваша роль не може запускати розсилки.</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function ChannelsSetup() {
  return (
    <Section title="Канали відправки">
      <dl className="dl">
        <dt>Telegram-бот</dt>
        <dd><Tag color="warning">потрібен токен бота з CRM</Tag></dd>
        <dt>Viber-бот</dt>
        <dd><Tag color="warning">потрібен токен; бот платний</Tag></dd>
        <dt>Email</dt>
        <dd><Tag color="warning">потрібна пошта / домен</Tag></dd>
      </dl>
    </Section>
  );
}

function Templates() {
  const { data, can } = useStore();
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const { actions } = useStore();
  const editable = can("mailings.send");
  return (
    <>
      {editable && (
        <div className="toolbar">
          <Button icon={<PlusOutlined />} onClick={() => setEditing({ id: actions.newTemplateId(), name: "", kind: "info", subject: "", body: "Доброго дня, {{name}}!\n" })}>
            Новий шаблон
          </Button>
        </div>
      )}
      <Table<MessageTemplate>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={data.templates}
        scroll={{ x: 800 }}
        columns={[
          { title: "Назва", dataIndex: "name" },
          { title: "Тип", render: (_, t) => <Tag>{KIND_LABELS[t.kind]}</Tag> },
          { title: "Текст", render: (_, t) => <span className="secondary">{t.body.slice(0, 110)}{t.body.length > 110 ? "…" : ""}</span> },
          {
            title: "",
            width: 60,
            render: (_, t) => editable && <Button size="small" type="text" icon={<EditOutlined />} aria-label="Редагувати" onClick={() => setEditing(t)} />,
          },
        ]}
      />
      <TemplateModal template={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TemplateModal({ template, onClose }: { template: MessageTemplate | null; onClose: () => void }) {
  const { data, index, today, actions } = useStore();
  const { message } = App.useApp();
  const [form] = Form.useForm<MessageTemplate>();
  const body: string = Form.useWatch("body", form) ?? template?.body ?? "";
  const sampleSub = data.subscribers[0];
  const sampleContact = index.contactsBySubscriber[sampleSub.id]?.[0];
  const sampleVars = sampleContact ? variablesFor(sampleSub, sampleContact, index, today) : {};

  const insert = (key: string) => form.setFieldValue("body", `${form.getFieldValue("body") ?? ""}{{${key}}}`);

  const submit = async () => {
    if (!template) return;
    const v = await form.validateFields();
    actions.saveTemplate({ ...template, ...v });
    message.success("Шаблон збережено");
    onClose();
  };

  return (
    <Modal open={!!template} onCancel={onClose} onOk={submit} okText="Зберегти" cancelText="Скасувати" title="Шаблон повідомлення" width={760} destroyOnHidden>
      {template && (
        <Form form={form} layout="vertical" preserve={false} initialValues={template}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <Form.Item name="name" label="Назва" rules={[{ required: true, message: "Обов'язкове поле" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="kind" label="Тип">
              <Select options={(Object.keys(KIND_LABELS) as TemplateKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
            </Form.Item>
          </div>
          <Form.Item name="subject" label="Тема (для Email)">
            <Input />
          </Form.Item>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <span className="secondary">Змінні:</span>
            {VARIABLES.map((v) => (
              <Tag key={v.key} className="var-chip" onClick={() => insert(v.key)} role="button">
                {v.label}
              </Tag>
            ))}
          </div>
          <Form.Item name="body" label="Текст" rules={[{ required: true, message: "Обов'язкове поле" }]}>
            <Input.TextArea rows={7} />
          </Form.Item>
          <div className="group-label">Приклад для «{sampleSub.name}»</div>
          <div className="preview-message">{render(body, sampleVars)}</div>
        </Form>
      )}
    </Modal>
  );
}

function AutoRules() {
  const { data, index, can, actions } = useStore();
  return (
    <>
      <p className="secondary">
        Сценарії запускаються за розкладом і надсилають повідомлення лише контактам з відповідною позначкою
        («оплата / борг» або «технічні»).
      </p>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={data.rules}
        scroll={{ x: 800 }}
        columns={[
          {
            title: "Увімкнено",
            width: 100,
            render: (_, r) => <Switch checked={r.enabled} disabled={!can("mailings.send")} onChange={(v) => actions.toggleRule(r.id, v)} />,
          },
          { title: "Сценарій", render: (_, r) => <div><b>{r.name}</b><div className="secondary">{r.description}</div></div> },
          { title: "Розклад", dataIndex: "schedule" },
          { title: "Шаблон", render: (_, r) => index.templateById[r.templateId]?.name },
        ]}
      />
    </>
  );
}

function History() {
  const { data, index } = useStore();
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={data.mailings}
      scroll={{ x: 800 }}
      columns={[
        { title: "Дата", render: (_, m) => <span className="num">{fmtDateTime(m.createdAt)}</span> },
        { title: "Шаблон", render: (_, m) => index.templateById[m.templateId]?.name },
        { title: "Аудиторія", dataIndex: "audience" },
        {
          title: "Надіслано",
          render: (_, m) => (
            <span className="num">
              {m.byChannel.telegram + m.byChannel.viber + m.byChannel.email}{" "}
              <span className="muted">(TG {m.byChannel.telegram} · Viber {m.byChannel.viber} · Email {m.byChannel.email})</span>
            </span>
          ),
        },
        { title: "Не доставлено", align: "right", render: (_, m) => m.skipped },
        { title: "Хто", render: (_, m) => USER_BY_ID[m.userId]?.name },
      ]}
    />
  );
}
