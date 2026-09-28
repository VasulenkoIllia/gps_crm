import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { App, Button, Checkbox, Dropdown, Empty, Form, InputNumber, Modal, Radio, Result, Select, Table, Tag, Timeline } from "antd";
import { ArrowLeftOutlined, DownOutlined, EditOutlined, SwapOutlined } from "@ant-design/icons";
import type { ObjectStatus } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { GRACE_DAYS, objectCost, objectDebt, objectPrice, overdueDays } from "../domain/billing";
import {
  ADDON_BY_ID, ADDONS, DISCONNECT_REASONS, modelLabel, REASON_BY_ID, SERVER_BY_ID, SIM_PLAN_BY_ID, TARIFF_BY_ID,
  TARIFFS, tariffLabel, USER_BY_ID,
} from "../data/reference";
import { fmtDate, fmtDateTime, fmtMoney, pct } from "../components/format";
import { DeviceStatusTag, PageTitle, ProgramDot, Section, SimStatusTag, StatusTag } from "../components/ui";
import PaymentModal from "../components/PaymentModal";

export default function ObjectCard() {
  const { id = "" } = useParams();
  const { data, index, today, can, isVisible, actions } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [editOpen, setEditOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const o = index.objectById[id];
  const sub = o ? index.subscriberById[o.subscriberId] : undefined;

  if (!o || !sub || !isVisible(sub)) {
    return <Result status="404" title="Об'єкт не знайдено" extra={<Link to="/objects">До списку об'єктів</Link>} />;
  }

  const device = o.deviceId ? index.deviceById[o.deviceId] : undefined;
  const sim = o.simId ? index.simById[o.simId] : undefined;
  const sensors = index.sensorsByObject[o.id] ?? [];
  const payer = index.payerById[o.payerId];
  const price = objectPrice(o);
  const cost = objectCost(o, sim?.planId);
  const margin = price.total - cost.total;
  const tariff = TARIFF_BY_ID[o.tariffId];
  const days = o.status === "disconnected" ? 0 : overdueDays(o.paidUntil, today);
  const debt = objectDebt(o, today);
  const history = index.auditByObject[o.id] ?? [];
  const objectPayments = data.payments.filter((p) => p.objectIds.includes(o.id)).sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 6);
  const finance = can("finance.view");
  const editable = can("objects.edit");

  const setStatus = (status: ObjectStatus) => {
    if (status === "disconnected") return setDisconnectOpen(true);
    actions.setObjectStatus(o.id, status);
    message.success(status === "active" ? "Об'єкт активовано" : "Об'єкт призупинено");
  };

  const statusMenu = [
    { key: "active", label: "Активувати", disabled: o.status === "active" },
    { key: "suspended", label: "Призупинити (несплата)", disabled: o.status !== "active" },
    { key: "disconnected", label: "Відключити…", danger: true, disabled: o.status === "disconnected" },
  ];

  return (
    <>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ paddingInline: 0, marginBottom: 4 }}>
        Назад
      </Button>
      <PageTitle
        title={
          <>
            {o.name} {o.plate && <span className="muted" style={{ fontWeight: 400 }}>{o.plate}</span>}
          </>
        }
        extra={
          <>
            {finance && can("payments.edit") && o.status !== "disconnected" && <Button onClick={() => setPayOpen(true)}>Внести оплату</Button>}
            {editable && (
              <Dropdown menu={{ items: statusMenu, onClick: ({ key }) => setStatus(key as ObjectStatus) }}>
                <Button>
                  Змінити статус <DownOutlined />
                </Button>
              </Dropdown>
            )}
          </>
        }
      >
        <StatusTag status={o.status} />
        <span>
          Абонент: <Link to={`/subscribers/${sub.id}`}>{sub.name}</Link> <span className="muted">({sub.code})</span>
        </span>
      </PageTitle>

      {o.status !== "disconnected" && days > GRACE_DAYS && o.status === "active" && finance && (
        <div className="panel" style={{ padding: "10px 16px", marginBottom: 16, borderColor: "#ec835a" }}>
          Оплата прострочена на <b>{days} дн.</b> За правилом «{GRACE_DAYS} днів» об'єкт має бути призупинено.
        </div>
      )}

      <div className="grid grid-2">
        <Section
          title="Обслуговування"
          extra={editable && <Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>Змінити</Button>}
        >
          <dl className="dl">
            <dt>Програма</dt>
            <dd><ProgramDot id={o.programId} /></dd>
            <dt>Сервер моніторингу</dt>
            <dd>{SERVER_BY_ID[o.serverId]?.name}</dd>
            <dt>Тариф</dt>
            <dd>{tariffLabel(o.tariffId)}</dd>
            <dt>Додаткові послуги</dt>
            <dd>{o.addonIds.length ? o.addonIds.map((a) => <Tag key={a}>{ADDON_BY_ID[a]?.name}</Tag>) : "-"}</dd>
            <dt>Знижка</dt>
            <dd>{o.discount ? `${o.discount} грн / міс` : "-"}</dd>
            <dt>Платник</dt>
            <dd>{payer?.name}</dd>
            <dt>Дата підключення</dt>
            <dd>{fmtDate(o.connectedAt)}</dd>
            {o.status === "disconnected" && (
              <>
                <dt>Дата відключення</dt>
                <dd>{fmtDate(o.disconnectedAt)}</dd>
                <dt>Причина</dt>
                <dd>{REASON_BY_ID[o.disconnectReasonId ?? ""]?.name ?? "-"}</dd>
              </>
            )}
          </dl>
        </Section>

        {finance ? (
          <Section title="Розрахунок на місяць">
            <div className="calc-row">
              <span className="secondary">
                Тариф {tariff?.name}
                {tariff?.period === "year" && ` (${fmtMoney(tariff.price)} / рік ÷ 12)`}
              </span>
              <span className="num">{fmtMoney(price.tariff)}</span>
            </div>
            <div className="calc-row">
              <span className="secondary">Додаткові послуги</span>
              <span className="num">{fmtMoney(price.addons)}</span>
            </div>
            <div className="calc-row">
              <span className="secondary">Знижка</span>
              <span className="num">{price.discount ? `−${fmtMoney(price.discount)}` : "-"}</span>
            </div>
            <div className="calc-row calc-total">
              <span>Абонплата / міс</span>
              <span className="num">{fmtMoney(price.total)}</span>
            </div>
            {can("cost.view") && (
              <>
                <div className="group-label" style={{ marginTop: 12 }}>
                  Собівартість
                </div>
                <div className="calc-row">
                  <span className="secondary">Розміщення в програмі</span>
                  <span className="num">{fmtMoney(cost.placement)}</span>
                </div>
                <div className="calc-row">
                  <span className="secondary">
                    SIM · {sim ? SIM_PLAN_BY_ID[sim.planId]?.name : "-"}
                  </span>
                  <span className="num">{fmtMoney(cost.sim)}</span>
                </div>
                <div className="calc-row calc-total">
                  <span>Маржа / міс</span>
                  <span className="num">
                    {fmtMoney(margin)} <span className="muted">({pct(margin, price.total)}%)</span>
                  </span>
                </div>
              </>
            )}
          </Section>
        ) : (
          <Section title="Розрахунок">
            <Empty description="Фінансові дані недоступні для вашої ролі" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </Section>
        )}

        <Section
          title="Обладнання"
          extra={can("equipment.edit") && o.status !== "disconnected" && (
            <Button size="small" icon={<SwapOutlined />} onClick={() => setSwapOpen(true)}>Замінити трекер</Button>
          )}
        >
          <div className="group-label">GPS-трекер</div>
          <dl className="dl">
            <dt>IMEI</dt>
            <dd className="num">{device?.imei ?? "-"}</dd>
            <dt>Модель</dt>
            <dd className={device?.modelId ? undefined : "muted"}>{modelLabel(device?.modelId)}</dd>
            <dt>Власність</dt>
            <dd>{device ? (device.ownership === "sold" ? "Продано клієнту" : "Оренда (наш)") : "-"}</dd>
            <dt>Статус</dt>
            <dd>{device ? <DeviceStatusTag status={device.status} /> : "-"}</dd>
          </dl>
          <div className="group-label">
            SIM-картка
          </div>
          <dl className="dl">
            <dt>ICCID</dt>
            <dd className="num">{sim?.iccid ?? "-"}</dd>
            <dt>Номер</dt>
            <dd className="num">{sim?.msisdn ?? "-"}</dd>
            <dt>Оператор / план</dt>
            <dd>{sim ? `${SIM_PLAN_BY_ID[sim.planId]?.operator} · ${SIM_PLAN_BY_ID[sim.planId]?.name}` : "-"}</dd>
            <dt>Статус</dt>
            <dd>{sim ? <SimStatusTag status={sim.status} /> : "-"}</dd>
          </dl>
          <div className="group-label">
            Додаткові датчики (ДУТ)
          </div>
          {sensors.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sensors.map((s) => <Tag key={s.id}>{s.kind} · SN {s.sn}</Tag>)}
            </div>
          ) : (
            <span className="muted">Немає</span>
          )}
        </Section>

        <div className="grid" style={{ alignContent: "start" }}>
          {finance && o.status !== "disconnected" && (
            <Section title="Оплата">
              <dl className="dl">
                <dt>Оплачено до</dt>
                <dd className={days ? "debt num" : "num"}>{fmtDate(o.paidUntil)}</dd>
                <dt>Прострочення</dt>
                <dd>{days ? `${days} дн.` : "немає"}</dd>
                <dt>Борг</dt>
                <dd className={debt ? "debt num" : "num"}>{debt ? fmtMoney(debt) : "немає"}</dd>
              </dl>
              {objectPayments.length > 0 && (
                <Table
                  size="small"
                  rowKey="id"
                  style={{ marginTop: 12 }}
                  pagination={false}
                  dataSource={objectPayments}
                  columns={[
                    { title: "Дата", render: (_, p) => fmtDate(p.paidAt) },
                    { title: "Період", render: (_, p) => `${fmtDate(p.periodFrom)} - ${fmtDate(p.periodTo)}` },
                    { title: "Сума (разом)", align: "right", render: (_, p) => <span className="num">{fmtMoney(p.amount)}</span> },
                  ]}
                />
              )}
            </Section>
          )}
          <Section title="Історія об'єкта">
            {history.length ? (
              <Timeline
                items={history.slice(0, 20).map((a) => ({
                  title: <span className="muted num">{fmtDateTime(a.at)}</span>,
                  content: (
                    <div>
                      <b>{a.action}</b> <span className="muted">· {USER_BY_ID[a.userId]?.name}</span>
                      {a.details && <div className="secondary">{a.details}</div>}
                    </div>
                  ),
                }))}
              />
            ) : (
              <span className="muted">Подій немає</span>
            )}
          </Section>
        </div>
      </div>

      <EditServiceModal open={editOpen} onClose={() => setEditOpen(false)} objectId={o.id} />
      <SwapDeviceModal open={swapOpen} onClose={() => setSwapOpen(false)} objectId={o.id} />
      <DisconnectModal open={disconnectOpen} onClose={() => setDisconnectOpen(false)} objectId={o.id} />
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} subscriberId={sub.id} payerId={o.payerId} />
    </>
  );
}

function EditServiceModal({ open, onClose, objectId }: { open: boolean; onClose: () => void; objectId: string }) {
  const { index, actions } = useStore();
  const { message } = App.useApp();
  const o = index.objectById[objectId];
  const [form] = Form.useForm<{ tariffId: string; addonIds: string[]; discount: number; payerId: string }>();
  const tariffId: string = Form.useWatch("tariffId", form) ?? o.tariffId;
  const programId = TARIFF_BY_ID[tariffId]?.programId ?? o.programId;
  const allowedAddons = ADDONS.filter((a) => a.programIds.includes(programId));

  const submit = async () => {
    const v = await form.validateFields();
    actions.updateObject(objectId, {
      tariffId: v.tariffId,
      addonIds: (v.addonIds ?? []).filter((id) => allowedAddons.some((a) => a.id === id)),
      discount: v.discount ?? 0,
      payerId: v.payerId,
    });
    message.success("Умови обслуговування змінено");
    onClose();
  };

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} title="Умови обслуговування" okText="Зберегти" cancelText="Скасувати" destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ tariffId: o.tariffId, addonIds: o.addonIds, discount: o.discount, payerId: o.payerId }}
      >
        <Form.Item name="tariffId" label="Тариф" rules={[{ required: true }]} extra="Лише тарифи поточної програми; перехід на іншу програму є окремою операцією">
          <Select
            options={TARIFFS.filter((t) => t.programId === o.programId).map((t) => ({ value: t.id, label: `${tariffLabel(t.id)}, ${fmtMoney(t.price)}` }))}
          />
        </Form.Item>
        <Form.Item name="addonIds" label="Додаткові послуги">
          {allowedAddons.length ? (
            <Checkbox.Group options={allowedAddons.map((a) => ({ value: a.id, label: `${a.name} · ${a.price} грн/міс` }))} />
          ) : (
            <span className="muted">Для цієї програми додаткових послуг немає</span>
          )}
        </Form.Item>
        <Form.Item name="discount" label="Знижка, грн / міс">
          <InputNumber min={0} step={10} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="payerId" label="Платник" rules={[{ required: true }]}>
          <Select options={(index.payersBySubscriber[o.subscriberId] ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function SwapDeviceModal({ open, onClose, objectId }: { open: boolean; onClose: () => void; objectId: string }) {
  const { data, index, actions } = useStore();
  const { message } = App.useApp();
  const [newDeviceId, setNewDeviceId] = useState<string>();
  const [oldStatus, setOldStatus] = useState<"repair" | "in_stock">("repair");
  const o = index.objectById[objectId];
  const current = o.deviceId ? index.deviceById[o.deviceId] : undefined;
  const stock = data.devices.filter((d) => d.status === "in_stock");

  const submit = () => {
    if (!newDeviceId) return void message.error("Оберіть трекер зі складу");
    actions.replaceDevice(objectId, newDeviceId, oldStatus);
    message.success("Трекер замінено, історія й оплати об'єкта збережені");
    setNewDeviceId(undefined);
    onClose();
  };

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} title="Заміна GPS-трекера" okText="Замінити" cancelText="Скасувати" destroyOnHidden>
      <p className="secondary">
        Об'єкт, тариф та історія оплат залишаються без змін, змінюється лише встановлений трекер. SIM-картка переходить у новий
        трекер.
      </p>
      <Form layout="vertical">
        <Form.Item label="Поточний трекер">
          <span className="num">{current ? `${modelLabel(current.modelId)} · IMEI ${current.imei}` : "-"}</span>
        </Form.Item>
        <Form.Item label={`Новий трекер зі складу (${stock.length} шт.)`} required>
          <Select
            showSearch={{ optionFilterProp: "label" }}
            value={newDeviceId}
            onChange={setNewDeviceId}
            placeholder="IMEI або модель"
            options={stock.map((d) => ({ value: d.id, label: `${modelLabel(d.modelId)} · IMEI ${d.imei}` }))}
          />
        </Form.Item>
        <Form.Item label="Що зробити зі старим трекером">
          <Radio.Group
            value={oldStatus}
            onChange={(e) => setOldStatus(e.target.value)}
            options={[
              { value: "repair", label: "У ремонт" },
              { value: "in_stock", label: "На склад" },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DisconnectModal({ open, onClose, objectId }: { open: boolean; onClose: () => void; objectId: string }) {
  const { actions } = useStore();
  const { message } = App.useApp();
  const [reasonId, setReasonId] = useState<string>();

  const submit = () => {
    if (!reasonId) return void message.error("Вкажіть причину відключення");
    actions.setObjectStatus(objectId, "disconnected", reasonId);
    message.success("Об'єкт відключено, SIM-картку позначено як заблоковану");
    setReasonId(undefined);
    onClose();
  };

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} title="Відключення об'єкта" okText="Відключити" okButtonProps={{ danger: true }} cancelText="Скасувати" destroyOnHidden>
      <Form layout="vertical">
        <Form.Item label="Причина відключення" required>
          <Select value={reasonId} onChange={setReasonId} options={DISCONNECT_REASONS.map((r) => ({ value: r.id, label: r.name }))} placeholder="Оберіть причину" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
