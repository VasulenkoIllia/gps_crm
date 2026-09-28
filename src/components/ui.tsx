import type { ReactNode } from "react";
import { Popover, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleOutlined, ExclamationCircleOutlined, MailOutlined, MessageOutlined, PauseCircleOutlined,
  SendOutlined, StopOutlined,
} from "@ant-design/icons";
import type { Channel, DeviceStatus, ObjectStatus, SimStatus, SubscriberStatus, SubscriberType } from "../domain/types";
import { PROGRAM_BY_ID, PROGRAM_COLORS } from "../data/reference";
import { QUESTIONS } from "../data/questions";
import { useStore } from "../store/DemoStore";

const STATUS: Record<SubscriberStatus, { label: string; color: string; icon: ReactNode }> = {
  active: { label: "Активний", color: "success", icon: <CheckCircleOutlined /> },
  suspended: { label: "Призупинений", color: "warning", icon: <PauseCircleOutlined /> },
  partial: { label: "Частково призупинений", color: "gold", icon: <ExclamationCircleOutlined /> },
  disconnected: { label: "Відключений", color: "default", icon: <StopOutlined /> },
};

export const STATUS_LABELS: Record<SubscriberStatus, string> = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v.label]),
) as Record<SubscriberStatus, string>;

export function StatusTag({ status }: { status: SubscriberStatus | ObjectStatus }) {
  const s = STATUS[status];
  return (
    <Tag color={s.color} icon={s.icon} style={{ marginInlineEnd: 0 }}>
      {s.label}
    </Tag>
  );
}

const TYPE_HINT: Record<SubscriberType, string> = {
  B2B: "Юридична особа / ФОП",
  B2C: "Фізична особа",
  B2G: "Держзамовник",
};

export function TypeTag({ type }: { type: SubscriberType }) {
  return (
    <Tooltip title={TYPE_HINT[type]}>
      <Tag style={{ marginInlineEnd: 0 }}>{type}</Tag>
    </Tooltip>
  );
}

export const TYPE_OPTIONS = (Object.keys(TYPE_HINT) as SubscriberType[]).map((t) => ({ value: t, label: `${t} — ${TYPE_HINT[t]}` }));

export function ProgramDot({ id }: { id: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: PROGRAM_COLORS[id] ?? "#898781", flex: "none" }} />
      {PROGRAM_BY_ID[id]?.name ?? id}
    </span>
  );
}

const CHANNEL: Record<Channel, { label: string; icon: ReactNode }> = {
  telegram: { label: "Telegram", icon: <SendOutlined /> },
  viber: { label: "Viber", icon: <MessageOutlined /> },
  email: { label: "Email", icon: <MailOutlined /> },
};

export const CHANNEL_LABELS: Record<Channel, string> = { telegram: "Telegram", viber: "Viber", email: "Email" };

export function ChannelTag({ channel }: { channel: Channel }) {
  const c = CHANNEL[channel];
  return (
    <Tag icon={c.icon} style={{ marginInlineEnd: 0 }}>
      {c.label}
    </Tag>
  );
}

const DEVICE_STATUS: Record<DeviceStatus, { label: string; color: string }> = {
  installed: { label: "Встановлено", color: "success" },
  in_stock: { label: "На складі", color: "processing" },
  repair: { label: "У ремонті", color: "warning" },
  dismantled: { label: "Знято з об'єкта", color: "default" },
  written_off: { label: "Списано", color: "error" },
};

export function DeviceStatusTag({ status }: { status: DeviceStatus }) {
  const s = DEVICE_STATUS[status];
  return <Tag color={s.color} style={{ marginInlineEnd: 0 }}>{s.label}</Tag>;
}
export const DEVICE_STATUS_OPTIONS = Object.entries(DEVICE_STATUS).map(([value, s]) => ({ value, label: s.label }));

const SIM_STATUS: Record<SimStatus, { label: string; color: string }> = {
  active: { label: "Активна", color: "success" },
  in_stock: { label: "На складі", color: "processing" },
  blocked: { label: "Заблокована", color: "default" },
};

export function SimStatusTag({ status }: { status: SimStatus }) {
  const s = SIM_STATUS[status];
  return <Tag color={s.color} style={{ marginInlineEnd: 0 }}>{s.label}</Tag>;
}
export const SIM_STATUS_OPTIONS = Object.entries(SIM_STATUS).map(([value, s]) => ({ value, label: s.label }));

/**
 * Open-question marker. Shows the client question and the assumption the demo makes;
 * hidden when the "Питання" switch in the header is off.
 */
export function Q({ id }: { id: string }) {
  const { ui } = useStore();
  const q = QUESTIONS[id];
  if (!ui.showQuestions || !q) return null;
  return (
    <Popover
      title={`Питання ${id}`}
      content={
        <div style={{ maxWidth: 340 }}>
          <Typography.Paragraph style={{ marginBottom: q.assumption ? 8 : 0 }}>{q.text}</Typography.Paragraph>
          {q.assumption && (
            <Typography.Text type="secondary">
              <b>У демо:</b> {q.assumption}
            </Typography.Text>
          )}
        </div>
      }
    >
      <span className="q-badge" role="button" tabIndex={0} aria-label={`Питання ${id}`}>
        ?
      </span>
    </Popover>
  );
}

export function PageTitle({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {children && <div className="page-subtitle">{children}</div>}
      </div>
      {extra && <div className="page-title-extra">{extra}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, q }: { label: string; value: ReactNode; hint?: ReactNode; q?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        {label} {q && <Q id={q} />}
      </div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function Section({ title, extra, children, q }: { title: ReactNode; extra?: ReactNode; children: ReactNode; q?: string }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="panel-title">
          {title} {q && <Q id={q} />}
        </span>
        {extra}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
