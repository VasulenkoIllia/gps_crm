import { OPERATOR_REQUIRED, referenceNameSchema, type SimPlan } from "@gps_crm/shared";
import { Form, Input, InputNumber } from "antd";
import { useMemo } from "react";
import { useCan } from "../../lib/session";
import { DictSelect, FormModal, zodRule, type DataTableColumn } from "../../ui";
import { PricedTab } from "./PricedTab";
import { FirstCostFields, firstCostOf, priceColumns, type FirstCostValues } from "./PriceParts";
import type { RowFormProps, TabProps } from "./ReferenceTab";
import { useReferenceSave } from "./reference-form";
import { REFERENCE_TEXTS } from "./reference-texts";
import { createReference, updateReference, useReferenceOptions } from "./references.api";

const COST_LABEL = "Вартість для нас";
const LABELS = { cost: COST_LABEL, newCost: "Нова вартість", history: "Історія вартості" };
const historyBlocks = (row: SimPlan) => [{ title: COST_LABEL, history: row.costs }];

interface SimPlanValues extends FirstCostValues {
  operatorId: string;
  name: string;
  note?: string;
  sortOrder?: number;
}

function SimPlanForm({ row, open, onClose }: RowFormProps<SimPlan>) {
  const [form] = Form.useForm<SimPlanValues>();
  const canReadCost = useCan("cost.read");
  const operators = useReferenceOptions("sim-operators", open);
  const save = useReferenceSave(
    (input: object) => (row ? updateReference("sim-plans", row.id, input) : createReference("sim-plans", input)),
    { form, clearFields: ["name", "note", "costAmount"], isNew: !row, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : REFERENCE_TEXTS["sim-plans"].add}
      open={open}
      onSubmit={(values, isAddingAnother) => {
        const input = {
          operatorId: values.operatorId,
          name: values.name,
          note: values.note ?? null,
          sortOrder: values.sortOrder ?? 0,
        };
        save.submit(row ? { ...input, version: row.version } : { ...input, ...firstCostOf(values) }, isAddingAnother);
      }}
    >
      <Form.Item
        label="Оператор"
        name="operatorId"
        required
        initialValue={row?.operatorId}
        rules={[{ required: true, message: OPERATOR_REQUIRED }]}
      >
        <DictSelect options={operators.options} isLoading={operators.isLoading} hasError={operators.hasError} />
      </Form.Item>
      <Form.Item label="Назва" name="name" required initialValue={row?.name} rules={[zodRule(referenceNameSchema)]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item label="Примітка" name="note" initialValue={row?.note ?? undefined}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item label="Порядок у списку" name="sortOrder" initialValue={row?.sortOrder ?? 0}>
        <InputNumber className="form-control-wide" min={0} precision={0} />
      </Form.Item>
      {!row && canReadCost && <FirstCostFields label={COST_LABEL} />}
    </FormModal>
  );
}

function buildColumns(canReadCost: boolean): DataTableColumn<SimPlan>[] {
  return [
    { title: "Оператор", dataIndex: "operatorName" },
    { title: "Назва", dataIndex: "name" },
    ...(canReadCost ? priceColumns<SimPlan>(COST_LABEL, (row) => row.costs) : []),
  ];
}

export function SimPlansTab(tab: TabProps) {
  const canReadCost = useCan("cost.read");
  const columns = useMemo(() => buildColumns(canReadCost), [canReadCost]);
  return (
    <PricedTab
      {...tab}
      kind="sim-plans"
      subjectType="sim_plan"
      labels={LABELS}
      columns={columns}
      RowForm={SimPlanForm}
      historyBlocks={historyBlocks}
    />
  );
}
