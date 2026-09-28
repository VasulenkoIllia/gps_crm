import { Table, Tabs, Tag, Tooltip } from "antd";
import type { Addon, DisconnectReason, MonitoringServer, SimPlan, Tariff, TrackerModel } from "../domain/types";
import { useStore } from "../store/DemoStore";
import {
  ADDONS, DISCONNECT_REASONS, PROGRAM_BY_ID, SERVERS, SIM_PLANS, TARIFFS, TRACKER_MODELS,
} from "../data/reference";
import { tariffMonthly } from "../domain/billing";
import { fmtMoney, fmtNum } from "../components/format";
import { PageTitle, ProgramDot } from "../components/ui";

/** Annual price vs 12 × monthly price of the same tariff: Forguard annual prices are not a flat −10%. */
function annualDiscount(t: Tariff): number | undefined {
  if (t.period !== "year") return undefined;
  const monthly = TARIFFS.find((x) => x.programId === t.programId && x.name === t.name && x.period === "month");
  return monthly ? 1 - t.price / (monthly.price * 12) : undefined;
}

export default function References() {
  const { data, can } = useStore();
  const costs = can("cost.view");
  const devicesByModel = (id: string) => data.devices.filter((d) => d.modelId === id).length;
  const objectsByReason = (id: string) => data.objects.filter((o) => o.disconnectReasonId === id).length;
  const objectsByTariff = (id: string) => data.objects.filter((o) => o.tariffId === id && o.status !== "disconnected").length;

  return (
    <>
      <PageTitle title="Тарифи та довідники">
        Тарифи та додаткові послуги взяті з вашої таблиці. {!can("references.edit") && "Редагування доступне адміністратору."}
      </PageTitle>
      <div className="panel" style={{ padding: "4px 16px 16px" }}>
        <Tabs
          items={[
            {
              key: "tariffs",
              label: "Тарифи",
              children: (
                <Table<Tariff>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={TARIFFS}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: "Програма", render: (_, t) => <ProgramDot id={t.programId} /> },
                    { title: "Тариф", dataIndex: "name" },
                    { title: "Період", render: (_, t) => (t.period === "month" ? "місяць" : "рік") },
                    { title: "Ціна", align: "right", render: (_, t) => <span className="num">{fmtMoney(t.price)}</span> },
                    { title: "Еквівалент / міс", align: "right", render: (_, t) => <span className="num">{fmtMoney(tariffMonthly(t))}</span> },
                    {
                      title: "Знижка за рік",
                      align: "right",
                      render: (_, t) => {
                        const d = annualDiscount(t);
                        if (d === undefined) return <span className="muted">-</span>;
                        const pctValue = d * 100;
                        const odd = Math.abs(pctValue - 10) > 0.5;
                        return (
                          <Tooltip title={odd ? "Не відповідає правилу «−10% за оплату на рік»" : "Відповідає правилу −10%"}>
                            <Tag color={odd ? "warning" : "default"}>−{fmtNum(pctValue, 1)}%</Tag>
                          </Tooltip>
                        );
                      },
                    },
                    { title: "Діючих об'єктів", align: "right", render: (_, t) => objectsByTariff(t.id) },
                  ]}
                />
              ),
            },
            {
              key: "addons",
              label: "Додаткові послуги",
              children: (
                <Table<Addon>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={ADDONS}
                  columns={[
                    { title: "Послуга", dataIndex: "name" },
                    { title: "Ціна / міс", align: "right", render: (_, a) => <span className="num">{fmtMoney(a.price)}</span> },
                    {
                      title: "Доступна для програм",
                      render: (_, a) => <div style={{ display: "flex", gap: 8 }}>{a.programIds.map((p) => <ProgramDot key={p} id={p} />)}</div>,
                    },
                    { title: "Підключено", align: "right", render: (_, a) => data.objects.filter((o) => o.status !== "disconnected" && o.addonIds.includes(a.id)).length },
                  ]}
                />
              ),
            },
            {
              key: "servers",
              label: "Програми та сервери",
              children: (
                <Table<MonitoringServer>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={SERVERS}
                  columns={[
                    { title: "Програма", render: (_, s) => <ProgramDot id={s.programId} /> },
                    { title: "Сервер", dataIndex: "name" },
                    ...(costs
                      ? [{
                          title: "Розміщення / об'єкт / міс",
                          align: "right" as const,
                          render: (_: unknown, s: MonitoringServer) => (
                            <span className="num">
                              {fmtMoney(s.placementCost ?? PROGRAM_BY_ID[s.programId].placementCost)}
                              {s.placementCost !== undefined && <span className="muted"> (свій)</span>}
                            </span>
                          ),
                        }]
                      : []),
                    { title: "Об'єктів", align: "right", render: (_, s) => data.objects.filter((o) => o.serverId === s.id && o.status !== "disconnected").length },
                  ]}
                />
              ),
            },
            {
              key: "sim",
              label: "Тарифи SIM",
              children: (
                <Table<SimPlan>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={SIM_PLANS}
                  columns={[
                    { title: "Оператор", dataIndex: "operator" },
                    { title: "План", dataIndex: "name" },
                    ...(costs
                      ? [{ title: "Вартість / міс", align: "right" as const, render: (_: unknown, p: SimPlan) => <span className="num">{fmtMoney(p.monthlyCost)}</span> }]
                      : []),
                    { title: "SIM-карток", align: "right", render: (_, p) => data.sims.filter((s) => s.planId === p.id).length },
                  ]}
                />
              ),
            },
            {
              key: "models",
              label: "Моделі трекерів",
              children: (
                <Table<TrackerModel>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={TRACKER_MODELS}
                  columns={[
                    { title: "Виробник", dataIndex: "vendor" },
                    { title: "Модель", dataIndex: "name" },
                    { title: "Трекерів в обліку", align: "right", render: (_, m) => devicesByModel(m.id) },
                  ]}
                />
              ),
            },
            {
              key: "reasons",
              label: "Причини відключення",
              children: (
                <Table<DisconnectReason>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={DISCONNECT_REASONS}
                  columns={[
                    { title: "Причина", dataIndex: "name" },
                    { title: "Відключено об'єктів", align: "right", render: (_, r) => objectsByReason(r.id) },
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
