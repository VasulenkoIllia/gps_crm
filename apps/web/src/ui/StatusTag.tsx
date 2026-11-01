import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { StatusMeta } from "@gps_crm/shared";
import { Tag } from "antd";
import type { ReactNode } from "react";

// Never the color alone: 05-ui-standard.md §5.9
const TONES: Record<StatusMeta["tone"], { color: string; icon: ReactNode }> = {
  good: { color: "success", icon: <CheckCircleOutlined /> },
  pending: { color: "processing", icon: <ClockCircleOutlined /> },
  warning: { color: "warning", icon: <ExclamationCircleOutlined /> },
  critical: { color: "error", icon: <StopOutlined /> },
  neutral: { color: "default", icon: <MinusCircleOutlined /> },
};

export function StatusTag({ status }: { status: StatusMeta }) {
  const { color, icon } = TONES[status.tone];
  return (
    <Tag color={color} icon={icon}>
      {status.label}
    </Tag>
  );
}
