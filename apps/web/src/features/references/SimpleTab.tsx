import { referenceNameSchema, type SimpleReference, type SimpleReferenceKind } from "@gps_crm/shared";
import { Form, Input, InputNumber } from "antd";
import { useCallback, useState } from "react";
import { EmptyValue, FormModal, zodRule, type DataTableColumn, type RowAction } from "../../ui";
import { ReferenceTab, type RowFormProps, type TabProps } from "./ReferenceTab";
import { useReferenceSave } from "./reference-form";
import { REFERENCE_TEXTS } from "./reference-texts";
import { createReference, updateReference } from "./references.api";

interface SimpleValues {
  name: string;
  note?: string;
  sortOrder?: number;
}

const COLUMNS: DataTableColumn<SimpleReference>[] = [
  { title: "Назва", dataIndex: "name" },
  { title: "Примітка", dataIndex: "note", render: (note: string | null) => note ?? <EmptyValue /> },
  { title: "Порядок", dataIndex: "sortOrder", align: "right" },
];

function SimpleForm({ kind, row, open, onClose }: RowFormProps<SimpleReference> & { kind: SimpleReferenceKind }) {
  const [form] = Form.useForm<SimpleValues>();
  const save = useReferenceSave(
    (input: object) => (row ? updateReference(kind, row.id, input) : createReference(kind, input)),
    { form, clearFields: ["name", "note"], isNew: !row, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : REFERENCE_TEXTS[kind].add}
      open={open}
      onSubmit={(values, isAddingAnother) => {
        const input = { name: values.name, note: values.note ?? null, sortOrder: values.sortOrder ?? 0 };
        save.submit(row ? { ...input, version: row.version } : input, isAddingAnother);
      }}
    >
      <Form.Item label="Назва" name="name" required initialValue={row?.name} rules={[zodRule(referenceNameSchema)]}>
        <Input autoComplete="off" autoFocus />
      </Form.Item>
      <Form.Item label="Примітка" name="note" initialValue={row?.note ?? undefined}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item
        label="Порядок у списку"
        name="sortOrder"
        initialValue={row?.sortOrder ?? 0}
        extra="Менше число стоїть вище; з однаковим числом записи йдуть за абеткою"
      >
        <InputNumber className="form-control-wide" min={0} precision={0} />
      </Form.Item>
    </FormModal>
  );
}

type SimpleAction = "edit";

export function SimpleTab({ kind, isAdding, canManage, onAdd, onAddClosed }: TabProps & { kind: SimpleReferenceKind }) {
  const [editing, setEditing] = useState<SimpleReference | null>(null);
  const actionsFor = useCallback(
    (_: SimpleReference, canEdit: boolean): RowAction<SimpleAction>[] =>
      canEdit ? [{ key: "edit", label: "Змінити" }] : [],
    [],
  );
  const onAction = useCallback((_: SimpleAction, row: SimpleReference) => setEditing(row), []);

  return (
    <>
      <ReferenceTab<SimpleReferenceKind, SimpleAction>
        kind={kind}
        columns={COLUMNS}
        canManage={canManage}
        onAdd={onAdd}
        actionsFor={actionsFor}
        onAction={onAction}
      />
      <SimpleForm
        kind={kind}
        row={editing}
        open={isAdding || editing !== null}
        onClose={() => {
          setEditing(null);
          onAddClosed();
        }}
      />
    </>
  );
}
