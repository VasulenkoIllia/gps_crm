import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Checkbox, Input, Select, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { Subscriber, SubscriberStatus, SubscriberType } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { PROGRAMS, USER_BY_ID, USERS } from "../data/reference";
import { fmtMoney, matches } from "../components/format";
import { PageTitle, ProgramDot, Q, STATUS_LABELS, StatusTag, TypeTag } from "../components/ui";
import { NewSubscriberModal } from "../components/SubscriberForms";

export default function Subscribers() {
  const { data, index, isVisible, can, currentUser } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<SubscriberStatus[]>([]);
  const [types, setTypes] = useState<SubscriberType[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [managers, setManagers] = useState<string[]>([]);
  const [debtOnly, setDebtOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const finance = can("finance.view");

  // One search string per subscriber: codes, tax id, contacts, objects, IMEI, SIM numbers.
  const haystack = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const s of data.subscribers) {
      const objs = index.objectsBySubscriber[s.id] ?? [];
      out[s.id] = [
        s.code, s.name, s.taxId ?? "",
        ...(index.contactsBySubscriber[s.id] ?? []).flatMap((c) => [c.fullName, c.phone, c.email ?? ""]),
        ...objs.flatMap((o) => [
          o.name, o.plate ?? "",
          o.deviceId ? index.deviceById[o.deviceId]?.imei ?? "" : "",
          o.simId ? index.simById[o.simId]?.msisdn ?? "" : "",
          o.simId ? index.simById[o.simId]?.iccid ?? "" : "",
        ]),
      ];
    }
    return out;
  }, [data.subscribers, index]);

  const rows = data.subscribers.filter((s) => {
    const sum = index.summaries[s.id];
    return (
      isVisible(s) &&
      matches(query, ...(haystack[s.id] ?? [])) &&
      (!statuses.length || statuses.includes(sum.status)) &&
      (!types.length || types.includes(s.type)) &&
      (!programs.length || sum.programIds.some((p) => programs.includes(p))) &&
      (!managers.length || managers.includes(s.managerId)) &&
      (!debtOnly || sum.debt > 0)
    );
  });

  const columns: ColumnsType<Subscriber> = [
    { title: "ID", dataIndex: "code", width: 110, render: (code: string) => <span className="num">{code}</span>, sorter: (a, b) => a.code.localeCompare(b.code), defaultSortOrder: "ascend" },
    {
      title: "Абонент",
      width: 260,
      sorter: (a, b) => a.name.localeCompare(b.name, "uk"),
      render: (_, s) => (
        <div>
          <div>{s.name}</div>
          {s.taxId && <div className="muted" style={{ fontSize: 12 }}>{s.type === "B2C" || s.taxId.length === 10 ? "ІПН" : "ЄДРПОУ"} {s.taxId}</div>}
        </div>
      ),
    },
    { title: "Тип", dataIndex: "type", width: 72, render: (t: SubscriberType) => <TypeTag type={t} /> },
    {
      title: "Статус",
      width: 190,
      render: (_, s) => <StatusTag status={index.summaries[s.id].status} />,
      sorter: (a, b) => index.summaries[a.id].status.localeCompare(index.summaries[b.id].status),
    },
    {
      title: "Програми",
      width: 130,
      render: (_, s) => (
        <div style={{ display: "grid", gap: 2 }}>
          {index.summaries[s.id].programIds.map((p) => <ProgramDot key={p} id={p} />)}
        </div>
      ),
    },
    {
      title: "Об'єкти",
      width: 110,
      align: "right",
      sorter: (a, b) => index.summaries[a.id].active - index.summaries[b.id].active,
      render: (_, s) => {
        const sum = index.summaries[s.id];
        return (
          <Tooltip title={`Активні: ${sum.active} · призупинені: ${sum.suspended} · відключені: ${sum.disconnected}`}>
            <span className="num">
              {sum.active}
              <span className="muted"> / {sum.total}</span>
            </span>
          </Tooltip>
        );
      },
    },
    { title: "Менеджер", width: 150, render: (_, s) => USER_BY_ID[s.managerId]?.name },
  ];

  if (finance) {
    columns.push(
      {
        title: "Оборот / міс",
        align: "right",
        width: 120,
        sorter: (a, b) => index.summaries[a.id].mrr - index.summaries[b.id].mrr,
        render: (_, s) => <span className="num">{fmtMoney(index.summaries[s.id].mrr)}</span>,
      },
      {
        title: "Борг",
        align: "right",
        width: 110,
        sorter: (a, b) => index.summaries[a.id].debt - index.summaries[b.id].debt,
        render: (_, s) => {
          const debt = index.summaries[s.id].debt;
          return debt > 0 ? <span className="num debt">{fmtMoney(debt)}</span> : <span className="muted">—</span>;
        },
      },
      {
        title: "LTV",
        align: "right",
        width: 120,
        sorter: (a, b) => index.summaries[a.id].ltv - index.summaries[b.id].ltv,
        render: (_, s) => <span className="num">{fmtMoney(index.summaries[s.id].ltv)}</span>,
      },
    );
  }

  const objectCount = rows.reduce((n, s) => n + index.summaries[s.id].total, 0);

  return (
    <>
      <PageTitle
        title="Абоненти"
        extra={
          can("subscribers.edit") && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Новий абонент
            </Button>
          )
        }
      >
        Знайдено {rows.length} абонентів · {objectCount} об'єктів
      </PageTitle>

      {!can("subscribers.all") && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={
            <>
              Показано лише абонентів, за якими закріплений {currentUser.name}. <Q id="6.1" />
            </>
          }
        />
      )}

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Назва, ID, ЄДРПОУ, телефон, IMEI, номер SIM…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 340, maxWidth: "100%" }}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Статус"
          value={statuses}
          onChange={setStatuses}
          style={{ minWidth: 160 }}
          options={(Object.keys(STATUS_LABELS) as SubscriberStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Тип"
          value={types}
          onChange={setTypes}
          style={{ minWidth: 110 }}
          options={["B2B", "B2C", "B2G"].map((t) => ({ value: t, label: t }))}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Програма"
          value={programs}
          onChange={setPrograms}
          style={{ minWidth: 140 }}
          options={PROGRAMS.map((p) => ({ value: p.id, label: p.name }))}
        />
        {can("subscribers.all") && (
          <Select
            mode="multiple"
            allowClear
            placeholder="Менеджер"
            value={managers}
            onChange={setManagers}
            style={{ minWidth: 150 }}
            options={USERS.filter((u) => u.role === "manager").map((u) => ({ value: u.id, label: u.name }))}
          />
        )}
        {finance && (
          <Checkbox checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} style={{ alignSelf: "center" }}>
            Лише з боргом
          </Checkbox>
        )}
      </div>

      <Table
        className="clickable-rows"
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 25, showSizeChanger: false }}
        scroll={{ x: 1150 }}
        onRow={(s) => ({ onClick: () => navigate(`/subscribers/${s.id}`) })}
      />

      <NewSubscriberModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
