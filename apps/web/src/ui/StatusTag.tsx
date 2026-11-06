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

// `isMark`: a mark, not a state, such as the main contact: a clock beside it read as «waiting» (manual test 05.11.2026)
export function StatusTag({ status, isMark = false }: { status: StatusMeta; isMark?: boolean }) {
  const { color, icon } = TONES[status.tone];
  return (
    <Tag color={color} icon={isMark ? undefined : icon}>
      {status.label}
    </Tag>
  );
}
