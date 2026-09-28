import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Segmented, Table } from "antd";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import type { GpsObject, SubscriberType } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { objectCost, objectDebt, objectPrice } from "../domain/billing";
import { modelLabel, PROGRAM_BY_ID, PROGRAM_COLORS, PROGRAMS, REASON_BY_ID } from "../data/reference";
import { fmtMoney, fmtNum, pct } from "../components/format";
import { BarList } from "../components/BarList";
import { Kpi, PageTitle, ProgramDot, Section } from "../components/ui";

const INK_2 = "#52514e";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const AXIS = "#c3c2b7";
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";

const compactMoney = (n: number) => (n >= 1000 ? `${fmtNum(n / 1000, n >= 10000 ? 0 : 1)} тис.` : fmtNum(n));

export default function Dashboard() {
  const { data, index, today, can, isVisible } = useStore();
  const [program, setProgram] = useState<string>("all");
  const finance = can("finance.view");
  const costs = can("cost.view");

  const m = useMemo(() => {
    const visibleSubs = data.subscribers.filter(isVisible);
    const visibleIds = new Set(visibleSubs.map((s) => s.id));
    const objs = data.objects.filter((o) => visibleIds.has(o.subscriberId) && (program === "all" || o.programId === program));
    const simPlan = (o: GpsObject) => (o.simId ? index.simById[o.simId]?.planId : undefined);
    const revenue = (list: GpsObject[]) => list.reduce((s, o) => s + objectPrice(o).total, 0);
    const cost = (list: GpsObject[]) => list.reduce((s, o) => s + objectCost(o, simPlan(o)).total, 0);
    const active = objs.filter((o) => o.status === "active");
    const suspended = objs.filter((o) => o.status === "suspended");
    const disconnected = objs.filter((o) => o.status === "disconnected");
    const live = objs.filter((o) => o.status !== "disconnected");
    const yearAgo = today.subtract(12, "month").format("YYYY-MM-DD");

    const byProgram = PROGRAMS.map((p) => {
      const a = active.filter((o) => o.programId === p.id);
      const clients = new Set(a.map((o) => o.subscriberId)).size;
      return {
        id: p.id,
        active: a.length,
        suspended: suspended.filter((o) => o.programId === p.id).length,
        disconnected: disconnected.filter((o) => o.programId === p.id).length,
        revenue: revenue(a),
        cost: cost(a),
        clients,
        avg: clients ? a.length / clients : 0,
      };
    }).filter((r) => program === "all" || r.id === program);

    const models = new Map<string, number>();
    for (const o of live) {
      const key = (o.deviceId && index.deviceById[o.deviceId]?.modelId) || "none";
      models.set(key, (models.get(key) ?? 0) + 1);
    }

    const activeClients = new Set(active.map((o) => o.subscriberId));
    const liveClients = new Set(live.map((o) => o.subscriberId));
    const types: SubscriberType[] = ["B2B", "B2C", "B2G"];
    const byType = types.map((t) => ({ type: t, count: visibleSubs.filter((s) => s.type === t && liveClients.has(s.id)).length }));

    // Proposal block: metrics beyond the client's dashboard sheet
    const months = Array.from({ length: 12 }, (_, i) => today.subtract(11 - i, "month").startOf("month"));
    const monthKey = (d: string) => d.slice(0, 7);
    const paymentsByMonth = new Map<string, number>();
    for (const p of data.payments) {
      if (!visibleIds.has(p.subscriberId)) continue;
      if (program !== "all" && !p.objectIds.some((id) => index.objectById[id]?.programId === program)) continue;
      paymentsByMonth.set(monthKey(p.paidAt), (paymentsByMonth.get(monthKey(p.paidAt)) ?? 0) + p.amount);
    }
    const revenueSeries = months.map((d) => ({ label: d.format("MM.YY"), full: d.format("MMMM YYYY"), value: paymentsByMonth.get(d.format("YYYY-MM")) ?? 0 }));
    const flowSeries = months.map((d) => {
      const k = d.format("YYYY-MM");
      return {
        label: d.format("MM.YY"),
        full: d.format("MMMM YYYY"),
        connected: objs.filter((o) => monthKey(o.connectedAt) === k).length,
        disconnected: objs.filter((o) => o.disconnectedAt && monthKey(o.disconnectedAt) === k).length,
      };
    });
    const reasons = new Map<string, number>();
    for (const o of disconnected) {
      if (!o.disconnectedAt || o.disconnectedAt < yearAgo) continue;
      const k = o.disconnectReasonId ?? "other";
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
    }
    const debtBySub = new Map<string, number>();
    for (const o of live) {
      const d = objectDebt(o, today);
      if (d > 0) debtBySub.set(o.subscriberId, (debtBySub.get(o.subscriberId) ?? 0) + d);
    }
    const topDebtors = [...debtBySub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, debt]) => ({ id, debt }));

    return {
      active, suspended, disconnected, live, revenue, cost, byProgram, models, byType, activeClients,
      revenueSeries, flowSeries, reasons, topDebtors,
      totalDebt: [...debtBySub.values()].reduce((s, v) => s + v, 0),
      disconnected12: disconnected.filter((o) => o.disconnectedAt && o.disconnectedAt >= yearAgo).length,
    };
  }, [data, index, isVisible, program, today]);

  const activeRevenue = m.revenue(m.active);
  const activeCost = m.cost(m.active);
  const avgPerClient = m.activeClients.size ? m.active.length / m.activeClients.size : 0;

  return (
    <>
      <PageTitle
        title="Дашборд"
        extra={
          <Segmented
            value={program}
            onChange={(v) => setProgram(String(v))}
            options={[{ value: "all", label: "Усі програми" }, ...PROGRAMS.map((p) => ({ value: p.id, label: p.name }))]}
          />
        }
      >
        Станом на {today.format("DD.MM.YYYY")} · показники з аркуша «Дашборд» вашої таблиці
      </PageTitle>

      <div className="group-label">1-2 · Активні об'єкти</div>
      <div className="kpi-row">
        <Kpi label="Активні об'єкти" value={fmtNum(m.active.length)} hint={`у ${m.activeClients.size} клієнтів`} />
        {finance && <Kpi label="Очікуваний оборот / міс" value={fmtMoney(activeRevenue)} hint="річні тарифи враховано як 1/12 на місяць" />}
        {costs && <Kpi label="Собівартість / міс" value={fmtMoney(activeCost)} hint="розміщення в програмі + SIM" />}
        {costs && <Kpi label="Маржа / міс" value={fmtMoney(activeRevenue - activeCost)} hint={`${pct(activeRevenue - activeCost, activeRevenue)}% від обороту`} />}
      </div>

      <div className="group-label">3-4 · Призупинені та відключені</div>
      <div className="kpi-row">
        <Kpi label="Призупинені об'єкти" value={fmtNum(m.suspended.length)} hint="відсутня оплата" />
        {finance && <Kpi label="Недоотримано / міс" value={fmtMoney(m.revenue(m.suspended))} hint="очікувана оплата по призупинених" />}
        {costs && <Kpi label="Витрати на призупинені / міс" value={<span className="debt">{fmtMoney(m.cost(m.suspended))}</span>} hint="платимо за SIM і розміщення без оплати" />}
        <Kpi label="Відключені об'єкти" value={fmtNum(m.disconnected.length)} hint={`з них за 12 міс: ${m.disconnected12}`} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Section title="Активні об'єкти за програмами">
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={m.byProgram}
            scroll={{ x: 520 }}
            columns={[
              { title: "Програма", render: (_, r) => <ProgramDot id={r.id} /> },
              { title: "Активні", align: "right", render: (_, r) => <span className="num">{r.active}</span> },
              { title: "Призуп.", align: "right", render: (_, r) => <span className="num">{r.suspended}</span> },
              ...(finance ? [{ title: "Оборот / міс", align: "right" as const, render: (_: unknown, r: (typeof m.byProgram)[number]) => <span className="num">{fmtMoney(r.revenue)}</span> }] : []),
              ...(costs
                ? [
                    { title: "Собівартість", align: "right" as const, render: (_: unknown, r: (typeof m.byProgram)[number]) => <span className="num">{fmtMoney(r.cost)}</span> },
                    { title: "Маржа", align: "right" as const, render: (_: unknown, r: (typeof m.byProgram)[number]) => <span className="num">{pct(r.revenue - r.cost, r.revenue)}%</span> },
                  ]
                : []),
            ]}
          />
        </Section>
        <Section title="Відключені об'єкти за програмами">
          <BarList
            rows={m.byProgram.map((r) => ({
              key: r.id,
              label: <ProgramDot id={r.id} />,
              value: r.disconnected,
              color: PROGRAM_COLORS[r.id],
              hint: `${PROGRAM_BY_ID[r.id].name}: ${r.disconnected} відключених`,
            }))}
          />
        </Section>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Section title="5 · Об'єкти за моделями трекерів">
          <BarList
            rows={[...m.models.entries()]
              .sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : b[1] - a[1]))
              .map(([id, count]) => ({
                key: id,
                label: modelLabel(id === "none" ? undefined : id),
                value: count,
                color: id === "none" ? AXIS : SERIES_1,
                hint: `${modelLabel(id === "none" ? undefined : id)}: ${count} об'єктів · ${pct(count, m.live.length)}%`,
              }))}
          />
        </Section>
        <Section title="6 · Клієнти за типом">
          <BarList
            rows={m.byType.map((r) => ({
              key: r.type,
              label: r.type,
              value: r.count,
              hint: `${r.count} клієнтів · ${pct(r.count, m.byType.reduce((s, x) => s + x.count, 0))}%`,
            }))}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Клієнти з хоча б одним діючим об'єктом</div>
        </Section>
        <Section title="7 · Середня к-сть об'єктів на клієнта">
          <div style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.1 }}>{fmtNum(avgPerClient, 1)}</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>активних об'єктів на клієнта</div>
          <BarList
            format={(n) => fmtNum(n, 1)}
            rows={m.byProgram.map((r) => ({
              key: r.id,
              label: <ProgramDot id={r.id} />,
              value: r.avg,
              color: PROGRAM_COLORS[r.id],
              hint: `${r.active} об'єктів / ${r.clients} клієнтів`,
            }))}
          />
        </Section>
      </div>

      <div className="group-label" style={{ marginTop: 24 }}>
        Пропозиції до дашборду
      </div>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {finance && (
          <Section title="Надходження оплат по місяцях">
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.revenueSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, fontSize: 11 }} interval="preserveStartEnd" minTickGap={4} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} tickFormatter={compactMoney} width={56} />
                  <Tooltip cursor={{ fill: "rgba(42,120,214,0.06)" }} labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ""} formatter={(v) => [fmtMoney(Number(v)), "Надійшло"]} />
                  <Bar dataKey="value" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}
        <Section title="Підключення та відключення по місяцях">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.flowSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, fontSize: 11 }} interval="preserveStartEnd" minTickGap={4} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} allowDecimals={false} width={32} />
                <Tooltip cursor={{ fill: "rgba(42,120,214,0.06)" }} labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ""} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: INK_2 }} />
                <Bar dataKey="connected" name="Підключено" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Bar dataKey="disconnected" name="Відключено" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        {finance && (
          <Section title="Найбільші боржники" extra={<span className="debt num">{fmtMoney(m.totalDebt)}</span>}>
            {m.topDebtors.length ? (
              <BarList
                format={fmtMoney}
                color="#d03b3b"
                rows={m.topDebtors.map((d) => ({
                  key: d.id,
                  label: <Link to={`/subscribers/${d.id}`}>{index.subscriberById[d.id].name}</Link>,
                  value: d.debt,
                }))}
              />
            ) : (
              <span className="muted">Боргів немає</span>
            )}
          </Section>
        )}
        <Section title="Причини відключень за 12 місяців">
          <BarList
            rows={[...m.reasons.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, count]) => ({ key: id, label: REASON_BY_ID[id]?.name ?? id, value: count, color: SERIES_2, hint: `${REASON_BY_ID[id]?.name ?? id}: ${count}` }))}
          />
        </Section>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        Дані оновлюються з кожною зміною. Останнє оновлення: {dayjs().format("DD.MM.YYYY HH:mm")}
      </div>
    </>
  );
}
