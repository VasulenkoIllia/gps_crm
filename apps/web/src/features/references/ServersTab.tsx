import { PROGRAM_REQUIRED, referenceNameSchema, serverUrlSchema, type Server } from "@gps_crm/shared";
import { Form, Input } from "antd";
import { useMemo } from "react";
import { useCan } from "../../lib/session";
import { DictSelect, EmptyValue, FormModal, zodRule, type DataTableColumn } from "../../ui";
import { PricedTab } from "./PricedTab";
import { FirstCostFields, firstCostOf, priceColumns, type FirstCostValues } from "./PriceParts";
import type { RowFormProps, TabProps } from "./ReferenceTab";
import { useReferenceSave } from "./reference-form";
import { REFERENCE_TEXTS } from "./reference-texts";
import { createReference, updateReference, useReferenceOptions } from "./references.api";

const COST_LABEL = "Собівартість ліцензії за 1 об'єкт";
const COST_COLUMN = "Собівартість ліцензії";
const LABELS = { cost: COST_LABEL, newCost: "Нова собівартість", history: "Історія собівартості" };
const historyBlocks = (row: Server) => [{ title: COST_COLUMN, history: row.costs }];

interface ServerValues extends FirstCostValues {
  programId: string;
  name: string;
  url?: string;
}

function ServerForm({ row, open, onClose }: RowFormProps<Server>) {
  const [form] = Form.useForm<ServerValues>();
  const canReadCost = useCan("cost.read");
  const programs = useReferenceOptions("programs", open);
  const save = useReferenceSave(
    (input: object) => (row ? updateReference("servers", row.id, input) : createReference("servers", input)),
    { form, clearFields: ["name", "url", "costAmount"], isNew: !row, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : REFERENCE_TEXTS.servers.add}
      open={open}
      onSubmit={(values, isAddingAnother) => {
        const input = { programId: values.programId, name: values.name, url: values.url ?? null };
        save.submit(row ? { ...input, version: row.version } : { ...input, ...firstCostOf(values) }, isAddingAnother);
      }}
    >
      <Form.Item
        label="Програма"
        name="programId"
        required
        initialValue={row?.programId}
        rules={[{ required: true, message: PROGRAM_REQUIRED }]}
      >
        <DictSelect options={programs.options} isLoading={programs.isLoading} hasError={programs.hasError} />
      </Form.Item>
      <Form.Item label="Назва" name="name" required initialValue={row?.name} rules={[zodRule(referenceNameSchema)]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item label="Адреса" name="url" initialValue={row?.url ?? undefined} rules={[zodRule(serverUrlSchema)]}>
        <Input type="url" autoComplete="off" placeholder="https://" />
      </Form.Item>
      {!row && canReadCost && <FirstCostFields label={COST_LABEL} />}
    </FormModal>
  );
}

function buildColumns(canReadCost: boolean): DataTableColumn<Server>[] {
  return [
    { title: "Програма", dataIndex: "programName" },
    { title: "Назва", dataIndex: "name" },
    { title: "Адреса", dataIndex: "url", render: (url: string | null) => url ?? <EmptyValue /> },
    ...(canReadCost ? priceColumns<Server>(COST_COLUMN, (row) => row.costs) : []),
  ];
}

export function ServersTab(tab: TabProps) {
  const canReadCost = useCan("cost.read");
  const columns = useMemo(() => buildColumns(canReadCost), [canReadCost]);
  return (
    <PricedTab
      {...tab}
      kind="servers"
      subjectType="server"
      labels={LABELS}
      columns={columns}
      RowForm={ServerForm}
      historyBlocks={historyBlocks}
    />
  );
}
