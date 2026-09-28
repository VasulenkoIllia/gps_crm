import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { App, Button, Empty, Result, Table, Tabs, Tag, Timeline, Tooltip, Upload } from "antd";
import {
  ArrowLeftOutlined, CheckOutlined, FilePdfOutlined, LinkOutlined, PlusOutlined, StarFilled, UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { Contact, Contract, GpsObject, Payment } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { objectDebt, objectPrice, overdueDays } from "../domain/billing";
import { ADDON_BY_ID, tariffLabel, USER_BY_ID } from "../data/reference";
import { fmtDate, fmtDateTime, fmtMoney } from "../components/format";
import { ChannelTag, Kpi, PageTitle, ProgramDot, Q, Section, StatusTag, TypeTag } from "../components/ui";
import PaymentModal, { METHOD_LABELS } from "../components/PaymentModal";
import { ContactModal } from "../components/SubscriberForms";

export default function SubscriberCard() {
  const { id = "" } = useParams();
  const { index, today, can, isVisible } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const sub = index.subscriberById[id];

  if (!sub || !isVisible(sub)) {
    return <Result status="404" title="Абонента не знайдено" subTitle="Або він закріплений за іншим менеджером." extra={<Link to="/subscribers">До списку абонентів</Link>} />;
  }

  const sum = index.summaries[sub.id];
  const objects = index.objectsBySubscriber[sub.id] ?? [];
  const contacts = index.contactsBySubscriber[sub.id] ?? [];
  const payers = index.payersBySubscriber[sub.id] ?? [];
  const contracts = index.contractsBySubscriber[sub.id] ?? [];
  const payments = [...(index.paymentsBySubscriber[sub.id] ?? [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const audit = index.auditBySubscriber[sub.id] ?? [];
  const finance = can("finance.view");
  const multiPayer = payers.length > 1;

  const objectColumns = [
    {
      title: "Об'єкт",
      render: (_: unknown, o: GpsObject) => (
        <div>
          <div>{o.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {o.plate ?? "—"} · IMEI {o.deviceId ? index.deviceById[o.deviceId]?.imei : "—"}
          </div>
        </div>
      ),
    },
    { title: "Програма", width: 120, render: (_: unknown, o: GpsObject) => <ProgramDot id={o.programId} /> },
    {
      title: "Тариф і послуги",
      render: (_: unknown, o: GpsObject) => (
        <div>
          <div>{tariffLabel(o.tariffId)}</div>
          {o.addonIds.length > 0 && <div className="muted" style={{ fontSize: 12 }}>+ {o.addonIds.map((a) => ADDON_BY_ID[a]?.name).join(", ")}</div>}
        </div>
      ),
    },
    ...(multiPayer
      ? [{ title: <>Платник <Q id="1.4" /></>, render: (_: unknown, o: GpsObject) => index.payerById[o.payerId]?.name }]
      : []),
    ...(finance
      ? [
          { title: "Сума / міс", align: "right" as const, render: (_: unknown, o: GpsObject) => <span className="num">{fmtMoney(objectPrice(o).total)}</span> },
          {
            title: <>Оплачено до <Q id="1.1" /></>,
            render: (_: unknown, o: GpsObject) => {
              if (o.status === "disconnected") return <span className="muted">—</span>;
              const days = overdueDays(o.paidUntil, today);
              return (
                <Tooltip title={days ? `Прострочено ${days} дн. · борг ${fmtMoney(objectDebt(o, today))}` : undefined}>
                  <span className={days ? "debt num" : "num"}>{fmtDate(o.paidUntil)}</span>
                </Tooltip>
              );
            },
          },
        ]
      : []),
    { title: "Статус", width: 150, render: (_: unknown, o: GpsObject) => <StatusTag status={o.status} /> },
  ];

  const contactColumns = [
    {
      title: "ПІБ",
      render: (_: unknown, c: Contact) => (
        <div>
          <div>
            {c.isPrimary && (
              <Tooltip title="Основна контактна особа">
                <StarFilled style={{ color: "#eda100", marginInlineEnd: 6 }} />
              </Tooltip>
            )}
            {c.fullName}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{c.position ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "Телефон / Email",
      render: (_: unknown, c: Contact) => (
        <div className="num">
          <div>{c.phone}</div>
          {c.phone2 && <div className="muted">{c.phone2}</div>}
          {c.email && <div className="secondary">{c.email}</div>}
        </div>
      ),
    },
    { title: <>Канал <Q id="5.5" /></>, render: (_: unknown, c: Contact) => <ChannelTag channel={c.channel} /> },
    {
      title: <>Chat ID <Q id="5.2" /></>,
      render: (_: unknown, c: Contact) => (
        <div style={{ fontSize: 12 }}>
          <div>Telegram: {c.telegramChatId ? <CheckOutlined style={{ color: "#0ca30c" }} /> : <span className="muted">немає</span>}</div>
          <div>Viber: {c.viberChatId ? <CheckOutlined style={{ color: "#0ca30c" }} /> : <span className="muted">немає</span>}</div>
        </div>
      ),
    },
    {
      title: "Отримує",
      render: (_: unknown, c: Contact) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {c.billingNotify && <Tag>Оплата / борг</Tag>}
          {c.techNotify && <Tag>Технічні</Tag>}
          {!c.billingNotify && !c.techNotify && <span className="muted">—</span>}
        </div>
      ),
    },
    {
      title: "CRM",
      width: 70,
      render: (_: unknown, c: Contact) => (
        <a href={c.crmUrl} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); message.info("Демо: відкриється картка контакту в CRM"); }}>
          <LinkOutlined />
        </a>
      ),
    },
  ];

  const paymentColumns = [
    { title: "Дата", render: (_: unknown, p: Payment) => <span className="num">{fmtDate(p.paidAt)}</span> },
    { title: "Сума", align: "right" as const, render: (_: unknown, p: Payment) => <span className="num">{fmtMoney(p.amount)}</span> },
    { title: "Період", render: (_: unknown, p: Payment) => <span className="num">{fmtDate(p.periodFrom)} – {fmtDate(p.periodTo)}</span> },
    { title: "Об'єктів", align: "right" as const, render: (_: unknown, p: Payment) => p.objectIds.length },
    ...(multiPayer ? [{ title: "Платник", render: (_: unknown, p: Payment) => index.payerById[p.payerId]?.name }] : []),
    { title: "Рахунок", render: (_: unknown, p: Payment) => p.invoiceNo ?? <span className="muted">—</span> },
    { title: "Спосіб", render: (_: unknown, p: Payment) => METHOD_LABELS[p.method] },
    { title: "Вніс", render: (_: unknown, p: Payment) => USER_BY_ID[p.createdBy]?.name },
  ];

  const contractColumns = [
    { title: "Номер", dataIndex: "number" },
    ...(multiPayer ? [{ title: "Платник", render: (_: unknown, k: Contract) => index.payerById[k.payerId]?.name }] : []),
    { title: "Підписано", render: (_: unknown, k: Contract) => fmtDate(k.signedAt) },
    {
      title: "Діє до",
      render: (_: unknown, k: Contract) => {
        const left = k.validUntil ? dayjs(k.validUntil).diff(today, "day") : undefined;
        return (
          <>
            {fmtDate(k.validUntil)}{" "}
            {left !== undefined && left < 0 && <Tag color="error">закінчився</Tag>}
            {left !== undefined && left >= 0 && left <= 30 && <Tag color="warning">за {left} дн.</Tag>}
          </>
        );
      },
    },
    { title: "Автопролонгація", render: (_: unknown, k: Contract) => (k.autoRenew ? "так" : "ні") },
    {
      title: "Файл",
      render: (_: unknown, k: Contract) =>
        k.fileName ? (
          <Button type="link" size="small" icon={<FilePdfOutlined />} onClick={() => message.info(`Демо: відкриється перегляд «${k.fileName}»`)}>
            {k.fileName}
          </Button>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  const tabs = [
    {
      key: "objects",
      label: `Об'єкти (${objects.length})`,
      children: (
        <Table
          className="clickable-rows"
          size="small"
          rowKey="id"
          dataSource={objects}
          columns={objectColumns}
          pagination={objects.length > 15 ? { pageSize: 15 } : false}
          scroll={{ x: 900 }}
          onRow={(o) => ({ onClick: () => navigate(`/objects/${o.id}`) })}
        />
      ),
    },
    {
      key: "contacts",
      label: `Контакти (${contacts.length})`,
      children: (
        <>
          {can("subscribers.edit") && (
            <div className="toolbar">
              <Button icon={<PlusOutlined />} onClick={() => setContactOpen(true)}>Додати контакт</Button>
            </div>
          )}
          <Table size="small" rowKey="id" dataSource={contacts} columns={contactColumns} pagination={false} scroll={{ x: 900 }} />
        </>
      ),
    },
    {
      key: "payers",
      label: (
        <span>
          Платники ({payers.length}) <Q id="1.4" />
        </span>
      ),
      children: (
        <div className="grid grid-2">
          {payers.map((p) => {
            const own = objects.filter((o) => o.payerId === p.id);
            const live = own.filter((o) => o.status !== "disconnected");
            const debt = live.reduce((s, o) => s + objectDebt(o, today), 0);
            const contract = contracts.find((k) => k.payerId === p.id);
            return (
              <Section
                key={p.id}
                title={p.name}
                extra={finance && can("payments.edit") && live.length > 0 && (
                  <Button size="small" onClick={() => setPaymentFor(p.id)}>Внести оплату</Button>
                )}
              >
                <dl className="dl">
                  <dt>{p.taxId?.length === 10 ? "ІПН" : "ЄДРПОУ"}</dt>
                  <dd className="num">{p.taxId ?? "—"}</dd>
                  <dt>IBAN платника</dt>
                  <dd className="num">{p.iban ?? "—"}</dd>
                  <dt>Форма оплати <Q id="1.7" /></dt>
                  <dd>{METHOD_LABELS[p.method]}</dd>
                  <dt>Об'єкти</dt>
                  <dd>{live.length} діючих{own.length > live.length ? `, ${own.length - live.length} відключених` : ""}</dd>
                  <dt>Договір</dt>
                  <dd>{contract ? `${contract.number} до ${fmtDate(contract.validUntil)}` : "—"}</dd>
                  {finance && (
                    <>
                      <dt>Абонплата / міс</dt>
                      <dd className="num">{fmtMoney(live.reduce((s, o) => s + objectPrice(o).total, 0))}</dd>
                      <dt>Борг</dt>
                      <dd className={debt ? "num debt" : "num"}>{debt ? fmtMoney(debt) : "немає"}</dd>
                    </>
                  )}
                </dl>
              </Section>
            );
          })}
        </div>
      ),
    },
    ...(finance
      ? [
          {
            key: "payments",
            label: `Оплати (${payments.length})`,
            children: (
              <>
                {can("payments.edit") && (
                  <div className="toolbar">
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPaymentFor(payers[0]?.id ?? "")}>Внести оплату</Button>
                  </div>
                )}
                <Table size="small" rowKey="id" dataSource={payments} columns={paymentColumns} pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 900 }} />
              </>
            ),
          },
        ]
      : []),
    {
      key: "contracts",
      label: (
        <span>
          Договори ({contracts.length}) <Q id="4.5" />
        </span>
      ),
      children: (
        <>
          {can("subscribers.edit") && (
            <div className="toolbar">
              <Upload beforeUpload={() => { message.info("Демо: договір буде завантажено і прив'язано до платника"); return false; }} showUploadList={false}>
                <Button icon={<UploadOutlined />}>Завантажити договір</Button>
              </Upload>
            </div>
          )}
          {contracts.length ? (
            <Table size="small" rowKey="id" dataSource={contracts} columns={contractColumns} pagination={false} scroll={{ x: 800 }} />
          ) : (
            <Empty description="Договір не підписувався" />
          )}
        </>
      ),
    },
    {
      key: "audit",
      label: "Журнал змін",
      children: (
        <Timeline
          items={audit.slice(0, 60).map((a) => ({
            title: <span className="muted num">{fmtDateTime(a.at)}</span>,
            content: (
              <div>
                <b>{a.action}</b> <span className="muted">· {USER_BY_ID[a.userId]?.name}</span>
                {a.details && <div className="secondary">{a.details}</div>}
              </div>
            ),
          }))}
        />
      ),
    },
  ];

  return (
    <>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate("/subscribers")} style={{ paddingInline: 0, marginBottom: 4 }}>
        Абоненти
      </Button>
      <PageTitle
        title={sub.name}
        extra={
          finance && can("payments.edit") && sum.total > sum.disconnected && (
            <Button type="primary" onClick={() => setPaymentFor(payers[0]?.id ?? "")}>Внести оплату</Button>
          )
        }
      >
        <Tag>{sub.code}</Tag>
        <TypeTag type={sub.type} />
        <StatusTag status={sum.status} />
        <Q id="4.1" />
      </PageTitle>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Section title="Картка абонента">
          <dl className="dl">
            <dt>{sub.type === "B2C" ? "ІПН" : "ЄДРПОУ / ІПН"}</dt>
            <dd className="num">{sub.taxId ?? "—"}</dd>
            <dt>Відповідальний менеджер <Q id="4.4" /></dt>
            <dd>{USER_BY_ID[sub.managerId]?.name}</dd>
            <dt>Дата реєстрації</dt>
            <dd>{fmtDate(sub.createdAt)}</dd>
            <dt>Посилання на CRM <Q id="5.1" /></dt>
            <dd>
              <a href={sub.crmUrl} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); message.info("Демо: відкриється картка клієнта в CRM"); }}>
                <LinkOutlined /> Відкрити в CRM
              </a>
            </dd>
            {sub.note && (
              <>
                <dt>Примітка</dt>
                <dd>{sub.note}</dd>
              </>
            )}
          </dl>
        </Section>
        <div className="kpi-row" style={{ marginBottom: 0 }}>
          <Kpi label="Активні об'єкти" value={sum.active} hint={`призупинені: ${sum.suspended} · відключені: ${sum.disconnected}`} />
          {finance && <Kpi label="Оборот / міс" value={fmtMoney(sum.mrr)} hint="за активними об'єктами" />}
          {finance && <Kpi label="Борг" value={<span className={sum.debt ? "debt" : undefined}>{fmtMoney(sum.debt)}</span>} q="1.1" />}
          {finance && <Kpi label="LTV" value={fmtMoney(sum.ltv)} hint="сплачено за весь час" />}
        </div>
      </div>

      <div className="panel" style={{ padding: "4px 16px 16px" }}>
        <Tabs items={tabs} />
      </div>

      <PaymentModal open={paymentFor !== null} onClose={() => setPaymentFor(null)} subscriberId={sub.id} payerId={paymentFor ?? undefined} />
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} subscriberId={sub.id} />
    </>
  );
}
