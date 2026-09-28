import { useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, Input, Select, Table, Tabs } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { Device, DeviceStatus, Sensor, Sim, SimStatus } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { modelLabel, SIM_PLAN_BY_ID, SIM_PLANS, TRACKER_MODELS } from "../data/reference";
import { fmtMoney, matches } from "../components/format";
import { DEVICE_STATUS_OPTIONS, DeviceStatusTag, Kpi, PageTitle, SIM_STATUS_OPTIONS, SimStatusTag } from "../components/ui";

export default function Equipment() {
  const { data, index, can } = useStore();
  const { message } = App.useApp();
  const [query, setQuery] = useState("");
  const [deviceStatuses, setDeviceStatuses] = useState<DeviceStatus[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [simStatuses, setSimStatuses] = useState<SimStatus[]>([]);
  const [plans, setPlans] = useState<string[]>([]);

  const objectLink = (objectId?: string) => {
    const o = objectId ? index.objectById[objectId] : undefined;
    if (!o) return <span className="muted">-</span>;
    const sub = index.subscriberById[o.subscriberId];
    return (
      <div>
        <Link to={`/objects/${o.id}`}>{o.name}</Link> <span className="muted">{o.plate}</span>
        <div className="secondary" style={{ fontSize: 12 }}>{sub.name}</div>
      </div>
    );
  };

  const devices = data.devices.filter(
    (d) =>
      matches(query, d.imei, modelLabel(d.modelId), d.objectId ? index.objectById[d.objectId]?.name : "") &&
      (!deviceStatuses.length || deviceStatuses.includes(d.status)) &&
      (!models.length || models.includes(d.modelId ?? "none")),
  );
  const sims = data.sims.filter(
    (s) =>
      matches(query, s.iccid, s.msisdn) &&
      (!simStatuses.length || simStatuses.includes(s.status)) &&
      (!plans.length || plans.includes(s.planId)),
  );
  const sensors = data.sensors.filter((s) => matches(query, s.sn, s.kind));

  const count = (status: DeviceStatus) => data.devices.filter((d) => d.status === status).length;
  const simObject = (s: Sim) => (s.deviceId ? index.deviceById[s.deviceId]?.objectId : undefined);
  const suspendedSimCost = data.sims
    .filter((s) => s.status === "active" && index.objectById[simObject(s) ?? ""]?.status === "suspended")
    .reduce((sum, s) => sum + (SIM_PLAN_BY_ID[s.planId]?.monthlyCost ?? 0), 0);

  return (
    <>
      <PageTitle
        title="Обладнання та SIM-картки"
        extra={
          can("equipment.edit") && (
            <Button icon={<PlusOutlined />} onClick={() => message.info("Демо: надходження обладнання на склад (IMEI / ICCID списком або з Excel)")}>
              Прихід на склад
            </Button>
          )
        }
      >
        Облік складу та встановленого обладнання
      </PageTitle>

      <div className="kpi-row">
        <Kpi label="Трекери встановлено" value={count("installed")} />
        <Kpi label="Трекери на складі" value={count("in_stock")} hint={`у ремонті: ${count("repair")} · списано: ${count("written_off")}`} />
        <Kpi label="SIM на складі" value={data.sims.filter((s) => s.status === "in_stock").length} />
        {can("cost.view") && (
          <Kpi label="SIM на призупинених об'єктах" value={fmtMoney(suspendedSimCost)} hint="витрати на місяць без оплати від клієнта" />
        )}
      </div>

      <div className="toolbar">
        <Input allowClear prefix={<SearchOutlined />} placeholder="IMEI, ICCID, номер, SN датчика…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 320, maxWidth: "100%" }} />
      </div>

      <div className="panel" style={{ padding: "4px 16px 16px" }}>
        <Tabs
          items={[
            {
              key: "devices",
              label: `GPS-трекери (${devices.length})`,
              children: (
                <>
                  <div className="toolbar">
                    <Select mode="multiple" allowClear placeholder="Статус" value={deviceStatuses} onChange={setDeviceStatuses} options={DEVICE_STATUS_OPTIONS} style={{ minWidth: 180 }} />
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Модель"
                      value={models}
                      onChange={setModels}
                      options={[...TRACKER_MODELS.map((m) => ({ value: m.id, label: `${m.vendor} ${m.name}` })), { value: "none", label: "Не вказано" }]}
                      style={{ minWidth: 180 }}
                    />
                  </div>
                  <Table<Device>
                    size="small"
                    rowKey="id"
                    dataSource={devices}
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: "IMEI", render: (_, d) => <span className="num">{d.imei}</span> },
                      { title: "Модель", render: (_, d) => <span className={d.modelId ? undefined : "muted"}>{modelLabel(d.modelId)}</span> },
                      { title: "Статус", render: (_, d) => <DeviceStatusTag status={d.status} /> },
                      { title: "Власність", render: (_, d) => (d.ownership === "sold" ? "Продано клієнту" : "Оренда (наш)") },
                      { title: "Об'єкт", render: (_, d) => objectLink(d.objectId) },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "sims",
              label: `SIM-картки (${sims.length})`,
              children: (
                <>
                  <div className="toolbar">
                    <Select mode="multiple" allowClear placeholder="Статус" value={simStatuses} onChange={setSimStatuses} options={SIM_STATUS_OPTIONS} style={{ minWidth: 160 }} />
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Оператор / план"
                      value={plans}
                      onChange={setPlans}
                      options={SIM_PLANS.map((p) => ({ value: p.id, label: `${p.operator} · ${p.name}` }))}
                      style={{ minWidth: 200 }}
                    />
                  </div>
                  <Table<Sim>
                    size="small"
                    rowKey="id"
                    dataSource={sims}
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                    scroll={{ x: 1000 }}
                    columns={[
                      { title: "ICCID (SN)", render: (_, s) => <span className="num">{s.iccid}</span> },
                      { title: "Номер", render: (_, s) => <span className="num">{s.msisdn}</span> },
                      { title: "Оператор / план", render: (_, s) => `${SIM_PLAN_BY_ID[s.planId]?.operator} · ${SIM_PLAN_BY_ID[s.planId]?.name}` },
                      ...(can("cost.view")
                        ? [{ title: "Вартість / міс", align: "right" as const, render: (_: unknown, s: Sim) => <span className="num">{fmtMoney(SIM_PLAN_BY_ID[s.planId]?.monthlyCost ?? 0)}</span> }]
                        : []),
                      { title: "Статус", render: (_, s) => <SimStatusTag status={s.status} /> },
                      { title: "Об'єкт", render: (_, s) => objectLink(simObject(s)) },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "sensors",
              label: `Датчики (${sensors.length})`,
              children: (
                <Table<Sensor>
                  size="small"
                  rowKey="id"
                  dataSource={sensors}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  columns={[
                    { title: "Тип", dataIndex: "kind" },
                    { title: "Серійний номер", render: (_, s) => <span className="num">{s.sn}</span> },
                    { title: "Об'єкт", render: (_, s) => objectLink(s.objectId) },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
