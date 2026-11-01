import { firstOfNextMonth, todayKyiv } from "@gps_crm/shared";
import { Form } from "antd";
import { useMemo } from "react";
import { DateInput, DictSelect } from "../../ui";
import { useReferenceOptions } from "../references/references.api";
import { isTariffDateRefused, tariffOptionsOf } from "./subscriber-form";

interface TariffFieldsProps {
  open: boolean;
  dateName: string;
  initial?: { programId: string };
}

// П25: the program first, then its tariffs, with the server and the period in view
export function TariffFields({ open, dateName, initial }: TariffFieldsProps) {
  const form = Form.useFormInstance();
  const programs = useReferenceOptions("programs", open);
  const tariffs = useReferenceOptions("tariffs", open);
  const programId = Form.useWatch("programId", form) as string | undefined;
  const options = useMemo(() => tariffOptionsOf(tariffs.items, programId), [tariffs.items, programId]);

  return (
    <>
      <Form.Item
        label="Програма"
        name="programId"
        required
        initialValue={initial?.programId}
        rules={[{ required: true, message: "Оберіть програму" }]}
      >
        <DictSelect
          options={programs.options}
          isLoading={programs.isLoading}
          hasError={programs.hasError}
          onChange={() => form.setFieldValue("tariffId", undefined)}
        />
      </Form.Item>
      <Form.Item label="Тариф" name="tariffId" required rules={[{ required: true, message: "Оберіть тариф" }]}>
        <DictSelect options={options} isLoading={tariffs.isLoading} hasError={tariffs.hasError} />
      </Form.Item>
      <Form.Item
        label="Діє з"
        name={dateName}
        required
        initialValue={firstOfNextMonth(todayKyiv())}
        rules={[{ required: true, message: "Оберіть дату" }]}
      >
        <DateInput className="form-control-wide" disabledDate={isTariffDateRefused} />
      </Form.Item>
    </>
  );
}
