import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { App, Button, Checkbox, Input, Select, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { GpsObject, ObjectStatus } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { objectDebt, objectPrice, overdueDays } from "../domain/billing";
import { ADDON_BY_ID, modelLabel, PROGRAMS, TARIFFS, TRACKER_MODELS, tariffLabel } from "../data/reference";
import { fmtDate, fmtMoney, matches } from "../components/format";
import { PageTitle, ProgramDot, StatusTag } from "../components/ui";

const STATUS_OPTIONS: { value: ObjectStatus; label: string }[] = [
  { value: "active", label: "Активні" },
  { value: "suspended", label: "Призупинені" },
  { value: "disconnected", label: "Відключені" },
];

export default function Objects() {
  const { data, index, today, can, isVisible } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<ObjectStatus[]>(["active", "suspended"]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [tariffs, setTariffs] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [debtOnly, setDebtOnly] = useState(false);
  const finance = can("finance.view");

  const rows = data.objects.filter((o) => {
    const sub = index.subscriberById[o.subscriberId];
    const device = o.deviceId ? index.deviceById[o.deviceId] : undefined;
    const sim = o.simId ? index.simById[o.simId] : undefined;
    return (
      isVisible(sub) &&
      matches(query, o.name, o.plate, device?.imei, sim?.iccid, sim?.msisdn, sub.name, sub.code) &&
      (!statuses.length || statuses.includes(o.status)) &&
      (!programs.length || programs.includes(o.programId)) &&
      (!tariffs.length || tariffs.includes(o.tariffId)) &&
      (!models.length || models.includes(device?.modelId ?? "none")) &&
      (!debtOnly || objectDebt(o, today) > 0)
    );
  });

  const columns: ColumnsType<GpsObject> = [
    {
      title: "Об'єкт",
      sorter: (a, b) => a.name.localeCompare(b.name, "uk"),
      render: (_, o) => (
        <div>
          <div>{o.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{o.plate ?? "без номера"}</div>
        </div>
      ),
    },
    {
      title: "Абонент",
      render: (_, o) => {
        const s = index.subscriberById[o.subscriberId];
        return (
          <Link to={`/subscribers/${s.id}`} onClick={(e) => e.stopPropagation()}>
            {s.name}
          </Link>
        );
      },
    },
    { title: "Програма", width: 120, render: (_, o) => <ProgramDot id={o.programId} /> },
    {
      title: "Тариф",
      render: (_, o) => (
        <div>
          <div>{tariffLabel(o.tariffId)}</div>
          {o.addonIds.length > 0 && <div className="muted" style={{ fontSize: 12 }}>+ {o.addonIds.map((a) => ADDON_BY_ID[a]?.name).join(", ")}</div>}
        </div>
      ),
    },
    {
      title: "Трекер",
      render: (_, o) => {
        const d = o.deviceId ? index.deviceById[o.deviceId] : undefined;
        return (
          <div>
            <div className={d?.modelId ? undefined : "muted"}>{modelLabel(d?.modelId)}</div>
            <div className="muted num" style={{ fontSize: 12 }}>{d?.imei}</div>
          </div>
        );
      },
    },
  ];
  if (finance) {
    columns.push(
      {
        title: "Сума / міс",
        align: "right",
        sorter: (a, b) => objectPrice(a).total - objectPrice(b).total,
        render: (_, o) => <span className="num">{fmtMoney(objectPrice(o).total)}</span>,
      },
      {
        title: "Оплачено до",
        sorter: (a, b) => a.paidUntil.localeCompare(b.paidUntil),
        render: (_, o) => {
          if (o.status === "disconnected") return <span className="muted">-</span>;
          const days = overdueDays(o.paidUntil, today);
          return (
            <Tooltip title={days ? `Прострочено ${days} дн.` : undefined}>
              <span className={days ? "num debt" : "num"}>{fmtDate(o.paidUntil)}</span>
            </Tooltip>
          );
        },
      },
    );
  }
  columns.push({ title: "Статус", width: 150, render: (_, o) => <StatusTag status={o.status} /> });

  return (
    <>
      <PageTitle
        title="Об'єкти"
        extra={
          <Button icon={<DownloadOutlined />} onClick={() => message.info("Демо: вивантаження у Excel за поточними фільтрами")}>
            Експорт
          </Button>
        }
      >
        Знайдено {rows.length} об'єктів
      </PageTitle>

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Назва, держномер, IMEI, ICCID, абонент…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 320, maxWidth: "100%" }}
        />
        <Select mode="multiple" allowClear placeholder="Статус" value={statuses} onChange={setStatuses} options={STATUS_OPTIONS} style={{ minWidth: 200 }} />
        <Select mode="multiple" allowClear placeholder="Програма" value={programs} onChange={setPrograms} options={PROGRAMS.map((p) => ({ value: p.id, label: p.name }))} style={{ minWidth: 140 }} />
        <Select
          mode="multiple"
          allowClear
          placeholder="Тариф"
          value={tariffs}
          onChange={setTariffs}
          options={TARIFFS.map((t) => ({ value: t.id, label: tariffLabel(t.id) }))}
          style={{ minWidth: 150 }}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Модель трекера"
          value={models}
          onChange={setModels}
          options={[...TRACKER_MODELS.map((m) => ({ value: m.id, label: `${m.vendor} ${m.name}` })), { value: "none", label: "Не вказано" }]}
          style={{ minWidth: 170 }}
        />
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
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 25, showSizeChanger: false }}
        scroll={{ x: 1150 }}
        onRow={(o) => ({ onClick: () => navigate(`/objects/${o.id}`) })}
      />
    </>
  );
}
