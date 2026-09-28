import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, DatePicker, Input, Result, Select, Table, Tabs, Tag, Tooltip } from "antd";
import { PlusOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import type { Payment, PaymentMethod } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { GRACE_DAYS, objectDebt, overdueDays } from "../domain/billing";
import { USER_BY_ID } from "../data/reference";
import { fmtDate, fmtMoney, matches } from "../components/format";
import { Kpi, PageTitle, StatusTag } from "../components/ui";
import PaymentModal, { METHOD_LABELS, METHOD_OPTIONS } from "../components/PaymentModal";

interface DebtorRow {
  id: string;
  subscriberId: string;
  payerId: string;
  objects: number;
  maxDays: number;
  /** Active objects past the grace period: candidates for suspension. */
  toSuspend: number;
  debt: number;
}

export default function Payments() {
  const { data, index, today, can, isVisible } = useStore();
  const { message } = App.useApp();
  const [payFor, setPayFor] = useState<{ subscriberId?: string; payerId?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([today.subtract(2, "month").startOf("month"), today]);

  // Debt is tracked per payer: one row per payer with overdue objects.
  const debtors = useMemo(() => {
    const rows: DebtorRow[] = [];
    for (const payer of data.payers) {
      const sub = index.subscriberById[payer.subscriberId];
      if (!isVisible(sub)) continue;
      const objs = (index.objectsBySubscriber[sub.id] ?? []).filter((o) => o.payerId === payer.id && objectDebt(o, today) > 0);
      if (!objs.length) continue;
      rows.push({
        id: payer.id,
        subscriberId: sub.id,
        payerId: payer.id,
        objects: objs.length,
        maxDays: Math.max(...objs.map((o) => overdueDays(o.paidUntil, today))),
        toSuspend: objs.filter((o) => o.status === "active" && overdueDays(o.paidUntil, today) > GRACE_DAYS).length,
        debt: objs.reduce((s, o) => s + objectDebt(o, today), 0),
      });
    }
    return rows.sort((a, b) => b.debt - a.debt);
  }, [data.payers, index, isVisible, today]);

  if (!can("finance.view")) {
    return <Result status="403" title="Немає доступу" subTitle="Фінансові дані недоступні для вашої ролі." />;
  }

  const payments = data.payments
    .filter((p) => {
      const sub = index.subscriberById[p.subscriberId];
      return (
        isVisible(sub) &&
        matches(query, sub.name, sub.code, p.invoiceNo, index.payerById[p.payerId]?.name) &&
        (!methods.length || methods.includes(p.method)) &&
        (!range || (p.paidAt >= range[0].format("YYYY-MM-DD") && p.paidAt <= range[1].format("YYYY-MM-DD")))
      );
    })
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const totalDebt = debtors.reduce((s, d) => s + d.debt, 0);
  const overGrace = debtors.filter((d) => d.toSuspend > 0);
  const monthStart = today.startOf("month").format("YYYY-MM-DD");
  const thisMonth = data.payments.filter((p) => p.paidAt >= monthStart && isVisible(index.subscriberById[p.subscriberId])).reduce((s, p) => s + p.amount, 0);

  const debtorColumns = [
    {
      title: "Абонент / платник",
      render: (_: unknown, r: DebtorRow) => {
        const sub = index.subscriberById[r.subscriberId];
        const payer = index.payerById[r.payerId];
        return (
          <div>
            <Link to={`/subscribers/${sub.id}`}>{sub.name}</Link> <span className="muted">{sub.code}</span>
            {payer.name !== sub.name && <div className="secondary" style={{ fontSize: 12 }}>Платник: {payer.name}</div>}
          </div>
        );
      },
    },
    { title: "Статус", render: (_: unknown, r: DebtorRow) => <StatusTag status={index.summaries[r.subscriberId].status} /> },
    { title: "Об'єктів з боргом", align: "right" as const, render: (_: unknown, r: DebtorRow) => r.objects },
    {
      title: "Прострочення",
      align: "right" as const,
      sorter: (a: DebtorRow, b: DebtorRow) => a.maxDays - b.maxDays,
      render: (_: unknown, r: DebtorRow) => (
        <span className="num">
          {r.maxDays} дн.{" "}
          {r.toSuspend > 0 && (
            <Tooltip title={`${r.toSuspend} активн. об'єкт(ів) прострочено більше ${GRACE_DAYS} днів, за правилом час призупиняти`}>
              <Tag color="warning">призупинити?</Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: "Борг",
      align: "right" as const,
      sorter: (a: DebtorRow, b: DebtorRow) => a.debt - b.debt,
      defaultSortOrder: "descend" as const,
      render: (_: unknown, r: DebtorRow) => <span className="num debt">{fmtMoney(r.debt)}</span>,
    },
    { title: "Менеджер", render: (_: unknown, r: DebtorRow) => USER_BY_ID[index.subscriberById[r.subscriberId].managerId]?.name },
    {
      title: "",
      width: 210,
      render: (_: unknown, r: DebtorRow) => (
        <div style={{ display: "flex", gap: 6 }}>
          {can("payments.edit") && (
            <Button size="small" onClick={() => setPayFor({ subscriberId: r.subscriberId, payerId: r.payerId })}>
              Оплата
            </Button>
          )}
          {can("mailings.send") && (
            <Button size="small" icon={<SendOutlined />} onClick={() => message.success("Демо: нагадування про борг поставлено в чергу")}>
              Нагадати
            </Button>
          )}
        </div>
      ),
    },
  ];

  const paymentColumns = [
    { title: "Дата", render: (_: unknown, p: Payment) => <span className="num">{fmtDate(p.paidAt)}</span> },
    {
      title: "Абонент",
      render: (_: unknown, p: Payment) => {
        const sub = index.subscriberById[p.subscriberId];
        return <Link to={`/subscribers/${sub.id}`}>{sub.name}</Link>;
      },
    },
    { title: "Сума", align: "right" as const, render: (_: unknown, p: Payment) => <span className="num">{fmtMoney(p.amount)}</span> },
    { title: "Період", render: (_: unknown, p: Payment) => <span className="num">{fmtDate(p.periodFrom)} - {fmtDate(p.periodTo)}</span> },
    { title: "Об'єктів", align: "right" as const, render: (_: unknown, p: Payment) => p.objectIds.length },
    { title: "Рахунок", render: (_: unknown, p: Payment) => p.invoiceNo ?? <span className="muted">-</span> },
    { title: "Спосіб", render: (_: unknown, p: Payment) => METHOD_LABELS[p.method] },
    { title: "Вніс", render: (_: unknown, p: Payment) => USER_BY_ID[p.createdBy]?.name },
  ];

  return (
    <>
      <PageTitle
        title="Оплати та заборгованість"
        extra={
          can("payments.edit") && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setPayFor({})}>
              Внести оплату
            </Button>
          )
        }
      >
        Облік оплат «оплачено до» по кожному об'єкту
      </PageTitle>

      <div className="kpi-row">
        <Kpi label="Загальний борг" value={<span className="debt">{fmtMoney(totalDebt)}</span>} hint={`${debtors.length} платників`} />
        <Kpi label={`Прострочено > ${GRACE_DAYS} днів`} value={overGrace.length} hint="платників з активними об'єктами, кандидати на призупинення" />
        <Kpi label="Надійшло цього місяця" value={fmtMoney(thisMonth)} hint={today.format("MMMM YYYY")} />
      </div>

      <div className="panel" style={{ padding: "4px 16px 16px" }}>
        <Tabs
          items={[
            {
              key: "debtors",
              label: `Боржники (${debtors.length})`,
              children: <Table size="small" rowKey="id" dataSource={debtors} columns={debtorColumns} pagination={false} scroll={{ x: 1000 }} />,
            },
            {
              key: "payments",
              label: "Усі оплати",
              children: (
                <>
                  <div className="toolbar">
                    <Input allowClear prefix={<SearchOutlined />} placeholder="Абонент, платник, № рахунку" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 280, maxWidth: "100%" }} />
                    <DatePicker.RangePicker value={range} onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)} format="DD.MM.YYYY" />
                    <Select mode="multiple" allowClear placeholder="Спосіб оплати" value={methods} onChange={setMethods} options={METHOD_OPTIONS} style={{ minWidth: 200 }} />
                  </div>
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={payments}
                    columns={paymentColumns}
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                    scroll={{ x: 1000 }}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}>
                          <b>Разом: {payments.length} оплат</b>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <b className="num">{fmtMoney(total)}</b>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} colSpan={5} />
                      </Table.Summary.Row>
                    )}
                  />
                </>
              ),
            },
          ]}
        />
      </div>

      <PaymentModal open={payFor !== null} onClose={() => setPayFor(null)} subscriberId={payFor?.subscriberId} payerId={payFor?.payerId} />
    </>
  );
}
