import { iccidSchema, imeiSchema, msisdnSchema, serialNoSchema, todayKyiv } from "@gps_crm/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AutoComplete, Form, Input } from "antd";
import { useMemo } from "react";
import { isFutureDay } from "../../lib/dayjs";
import { REMOTE_SELECT_KEY } from "../../lib/query-client";
import { DateInput, DictSelect, useDebouncedValue, zodRule, type RemoteOption } from "../../ui";
import { useReferenceOptions } from "../references/references.api";
import { checkIccid, checkImei, searchFreeDevices, searchFreeSensors, searchFreeSims } from "./equipment.api";
import { isFreeRecord } from "./number-check";
import { NumberHint, useNumberCheck } from "./NumberHint";

interface NumberFieldProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  name: string;
  isDigits?: boolean;
  search: (text: string, signal: AbortSignal) => Promise<RemoteOption[]>;
}

// Text and not a choice: a free record comes up as a person types, and a number nobody knows yet is a new record
function NumberField({ name, value, isDigits, search, ...field }: NumberFieldProps) {
  const settled = useDebouncedValue(value?.trim() ?? "");
  const found = useQuery({
    queryKey: [...REMOTE_SELECT_KEY, name, settled],
    queryFn: ({ signal }) => search(settled, signal),
    placeholderData: keepPreviousData,
  });
  return (
    <AutoComplete {...field} value={value} options={found.data} showSearch={{ filterOption: false }}>
      <Input inputMode={isDigits ? "numeric" : undefined} />
    </AutoComplete>
  );
}

interface PastDateFieldProps {
  label: string;
  name: string | (string | number)[];
}

// Stage 1 takes no date ahead: what happened on a day is written on that day or after it
export function PastDateField({ label, name }: PastDateFieldProps) {
  return (
    <Form.Item
      label={label}
      name={name}
      required
      initialValue={todayKyiv()}
      rules={[{ required: true, message: "Оберіть дату" }]}
    >
      <DateInput className="form-control-wide" disabledDate={isFutureDay} />
    </Form.Item>
  );
}

export function ContractorField({ open }: { open: boolean }) {
  const contractors = useReferenceOptions("contractors", open);
  return (
    <Form.Item label="Підрядник" name="contractorId">
      <DictSelect options={contractors.options} isLoading={contractors.isLoading} hasError={contractors.hasError} />
    </Form.Item>
  );
}

const DEVICE = "device";

// The tracker of an object: a free one, or a new one with its model
export function DeviceChoiceFields({ open }: { open: boolean }) {
  const form = Form.useFormInstance();
  const models = useReferenceOptions("tracker-models", open);
  const imei = Form.useWatch([DEVICE, "imei"], form) as string | undefined;
  const found = useNumberCheck("imei", imei, checkImei);
  return (
    <>
      <NumberHint result={found} isForInstallation />
      <Form.Item label="IMEI" name={[DEVICE, "imei"]} required rules={[zodRule(imeiSchema)]}>
        <NumberField name="free-devices" isDigits search={searchFreeDevices} />
      </Form.Item>
      {!isFreeRecord(found) && (
        <Form.Item label="Модель" name={[DEVICE, "modelId"]}>
          <DictSelect options={models.options} isLoading={models.isLoading} hasError={models.hasError} />
        </Form.Item>
      )}
    </>
  );
}

// Operator first: the list of plans depends on it (equipment.md П10)
function useSimPlanOptions(open: boolean, operatorId: string | undefined) {
  const plans = useReferenceOptions("sim-plans", open);
  const options = useMemo(
    () =>
      (plans.items ?? [])
        .filter((plan) => plan.operatorId === operatorId)
        .map(({ id, name, isActive }) => ({ value: id, label: name, isActive })),
    [plans.items, operatorId],
  );
  return { options, isLoading: plans.isLoading, hasError: plans.hasError };
}

interface SimDetailFieldsProps {
  open: boolean;
  prefix?: string[];
  initial?: { msisdn: string | null; operatorId: string | null; planId: string | null };
}

export function SimDetailFields({ open, prefix = [], initial }: SimDetailFieldsProps) {
  const form = Form.useFormInstance();
  const operators = useReferenceOptions("sim-operators", open);
  const operatorId = Form.useWatch([...prefix, "operatorId"], form) as string | undefined;
  const plans = useSimPlanOptions(open, operatorId);
  return (
    <>
      <Form.Item
        label="Номер"
        name={[...prefix, "msisdn"]}
        initialValue={initial?.msisdn ?? undefined}
        rules={[zodRule(msisdnSchema.optional())]}
      >
        <Input inputMode="tel" />
      </Form.Item>
      <Form.Item label="Оператор" name={[...prefix, "operatorId"]} initialValue={initial?.operatorId ?? undefined}>
        <DictSelect
          options={operators.options}
          isLoading={operators.isLoading}
          hasError={operators.hasError}
          onChange={() => form.setFieldValue([...prefix, "planId"], undefined)}
        />
      </Form.Item>
      <Form.Item label="Тариф оператора" name={[...prefix, "planId"]} initialValue={initial?.planId ?? undefined}>
        <DictSelect options={plans.options} isLoading={plans.isLoading} hasError={plans.hasError} />
      </Form.Item>
    </>
  );
}

const SIM = "sim";

// The SIM of an object: a free one, or a new one with its number, operator and plan
export function SimChoiceFields({ open }: { open: boolean }) {
  const form = Form.useFormInstance();
  const iccid = Form.useWatch([SIM, "iccid"], form) as string | undefined;
  const found = useNumberCheck("iccid", iccid, checkIccid);
  return (
    <>
      <NumberHint result={found} isForInstallation />
      <Form.Item label="ICCID" name={[SIM, "iccid"]} required rules={[zodRule(iccidSchema)]}>
        <NumberField name="free-sims" isDigits search={searchFreeSims} />
      </Form.Item>
      {!isFreeRecord(found) && <SimDetailFields open={open} prefix={[SIM]} />}
    </>
  );
}

// `name` is a path, because the same field stands alone in a modal and in a row of the form of a new object
export function SensorChoiceField({ name }: { name: (string | number)[] }) {
  return (
    <Form.Item label="Серійний номер" name={name} required rules={[zodRule(serialNoSchema)]}>
      <NumberField name="free-sensors" search={searchFreeSensors} />
    </Form.Item>
  );
}
