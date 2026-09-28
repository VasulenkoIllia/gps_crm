import { useEffect, useMemo, useState } from "react";
import { App, DatePicker, Form, Input, InputNumber, Modal, Segmented, Select, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { PaymentMethod } from "../domain/types";
import { useStore } from "../store/DemoStore";
import { extendPaidUntil, objectPrice } from "../domain/billing";
import { TARIFF_BY_ID } from "../data/reference";
import { fmtDate, fmtMoney } from "./format";
import { Q } from "./ui";

export const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "invoice", label: "Безготівка за рахунком" },
  { value: "iban", label: "Переказ на IBAN" },
  { value: "card", label: "Картка / платіжне посилання" },
  { value: "cash", label: "Готівка" },
];
export const METHOD_LABELS = Object.fromEntries(METHOD_OPTIONS.map((m) => [m.value, m.label])) as Record<PaymentMethod, string>;

interface Props {
  open: boolean;
  onClose: () => void;
  subscriberId?: string;
  payerId?: string;
}

export default function PaymentModal({ open, onClose, subscriberId: fixedSubscriberId, payerId: initialPayerId }: Props) {
  const { data, index, today, actions, isVisible } = useStore();
  const { message } = App.useApp();
  const [subscriberId, setSubscriberId] = useState<string | undefined>(fixedSubscriberId);
  const [payerId, setPayerId] = useState<string>();
  const [objectIds, setObjectIds] = useState<string[]>([]);
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [paidAt, setPaidAt] = useState<Dayjs>(today);
  const [method, setMethod] = useState<PaymentMethod>("invoice");
  const [invoiceNo, setInvoiceNo] = useState("");

  const payers = subscriberId ? index.payersBySubscriber[subscriberId] ?? [] : [];
  const payerObjects = useMemo(
    () =>
      subscriberId && payerId
        ? (index.objectsBySubscriber[subscriberId] ?? []).filter((o) => o.payerId === payerId && o.status !== "disconnected")
        : [],
    [index, subscriberId, payerId],
  );

  const selectPayer = (id: string | undefined, subId = subscriberId) => {
    setPayerId(id);
    const payer = id ? index.payerById[id] : undefined;
    const objs = subId && id ? (index.objectsBySubscriber[subId] ?? []).filter((o) => o.payerId === id && o.status !== "disconnected") : [];
    setObjectIds(objs.map((o) => o.id));
    setMonths(objs.length && objs.every((o) => TARIFF_BY_ID[o.tariffId]?.period === "year") ? 12 : 1);
    if (payer) setMethod(payer.method);
    setAmountTouched(false);
  };

  useEffect(() => {
    if (!open) return;
    const subId = fixedSubscriberId;
    setSubscriberId(subId);
    setPaidAt(today);
    setInvoiceNo(`Р-${today.format("YYMM")}-${String(data.seq.invoice).padStart(4, "0")}`);
    const firstPayer = initialPayerId ?? (subId ? index.payersBySubscriber[subId]?.[0]?.id : undefined);
    selectPayer(firstPayer, subId);
    // Re-initialise only when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = payerObjects.filter((o) => objectIds.includes(o.id));
  const suggested = Math.round(selected.reduce((s, o) => s + objectPrice(o).total * months, 0));
  const finalAmount = amountTouched ? amount ?? 0 : suggested;

  const submit = () => {
    if (!subscriberId || !payerId) return void message.error("Оберіть абонента і платника");
    if (!objectIds.length) return void message.error("Оберіть хоча б один об'єкт");
    if (finalAmount <= 0) return void message.error("Сума має бути більшою за нуль");
    actions.addPayment({
      subscriberId, payerId, objectIds, months, amount: finalAmount, paidAt: paidAt.format("YYYY-MM-DD"), method,
      invoiceNo: method === "invoice" ? invoiceNo : undefined,
    });
    message.success(`Оплату ${fmtMoney(finalAmount)} внесено`);
    onClose();
  };

  const subscriberOptions = data.subscribers
    .filter(isVisible)
    .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }));

  return (
    <Modal open={open} onCancel={onClose} onOk={submit} okText="Внести оплату" cancelText="Скасувати" title="Внесення оплати" width={760} destroyOnHidden>
      <Form layout="vertical">
        {!fixedSubscriberId && (
          <Form.Item label="Абонент" required>
            <Select
              showSearch={{ optionFilterProp: "label" }}
              placeholder="Пошук за назвою або ID"
              value={subscriberId}
              options={subscriberOptions}
              onChange={(id: string) => {
                setSubscriberId(id);
                selectPayer(index.payersBySubscriber[id]?.[0]?.id, id);
              }}
            />
          </Form.Item>
        )}
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Form.Item label={<>Платник <Q id="1.4" /></>} required style={{ marginBottom: 12 }}>
            <Select value={payerId} onChange={(id: string) => selectPayer(id)} options={payers.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item label={<>Спосіб оплати <Q id="1.7" /></>} style={{ marginBottom: 12 }}>
            <Select value={method} onChange={setMethod} options={METHOD_OPTIONS} />
          </Form.Item>
          <Form.Item label={<>Дата оплати <Q id="1.8" /></>} style={{ marginBottom: 12 }}>
            <DatePicker value={paidAt} onChange={(d) => d && setPaidAt(d)} format="DD.MM.YYYY" style={{ width: "100%" }} allowClear={false} />
          </Form.Item>
          {method === "invoice" ? (
            <Form.Item label={<>Номер рахунку <Q id="1.5" /></>} style={{ marginBottom: 12 }}>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </Form.Item>
          ) : (
            <div />
          )}
        </div>
        <Form.Item label={<>Оплачений період <Q id="1.3" /></>} style={{ marginBottom: 12 }}>
          <Segmented
            value={months}
            onChange={(v) => {
              setMonths(Number(v));
              setAmountTouched(false);
            }}
            options={[1, 2, 3, 6, 12].map((m) => ({ value: m, label: m === 12 ? "12 міс (рік)" : `${m} міс` }))}
          />
        </Form.Item>
        <Form.Item label={`Об'єкти платника (${selected.length} з ${payerObjects.length})`} style={{ marginBottom: 12 }}>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            scroll={{ y: 220 }}
            dataSource={payerObjects}
            rowSelection={{ selectedRowKeys: objectIds, onChange: (keys) => { setObjectIds(keys as string[]); setAmountTouched(false); } }}
            columns={[
              { title: "Об'єкт", render: (_, o) => <>{o.name} <span className="muted">{o.plate}</span></> },
              {
                title: "Оплачено до",
                render: (_, o) => (
                  <span className={dayjs(o.paidUntil).isBefore(today) ? "debt" : undefined}>{fmtDate(o.paidUntil)}</span>
                ),
              },
              {
                title: "Після оплати",
                render: (_, o) =>
                  objectIds.includes(o.id) ? (
                    <>
                      <span className={dayjs(extendPaidUntil(o.paidUntil, months)).isBefore(today) ? "debt" : undefined}>
                        {fmtDate(extendPaidUntil(o.paidUntil, months))}
                      </span>{" "}
                      {o.status === "suspended" && !dayjs(extendPaidUntil(o.paidUntil, months)).isBefore(today) && (
                        <Tag color="success">відновиться</Tag>
                      )}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  ),
              },
              { title: "Сума", align: "right", render: (_, o) => <span className="num">{fmtMoney(objectPrice(o).total * months)}</span> },
            ]}
          />
        </Form.Item>
        <Form.Item
          label="Сума оплати, грн"
          extra={amountTouched && finalAmount !== suggested ? `Розрахункова сума: ${fmtMoney(suggested)}` : "Розраховано автоматично за тарифами, можна змінити"}
          style={{ marginBottom: 0 }}
        >
          <InputNumber
            value={finalAmount}
            min={0}
            step={10}
            style={{ width: 220 }}
            onChange={(v) => {
              setAmount(typeof v === "number" ? v : null);
              setAmountTouched(true);
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
