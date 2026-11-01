import { SYSTEM_STATE_TONES, type SystemVerdict } from "@gps_crm/shared";
import { StatusTag } from "../../ui";

export function VerdictTag({ verdict }: { verdict: SystemVerdict }) {
  return <StatusTag status={{ label: verdict.label, tone: SYSTEM_STATE_TONES[verdict.state] }} />;
}
