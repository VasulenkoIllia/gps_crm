import {
  CONTRACT_FILE_MAX_BYTES,
  CONTRACT_FILE_TEXT,
  contractNumberSchema,
  noteTextSchema,
  type Contract,
} from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { App, Form, Input } from "antd";
import { useMemo } from "react";
import {
  DateInput,
  DictSelect,
  EntityLink,
  errorMessage,
  FileInput,
  FormModal,
  useDebouncedValue,
  zodRule,
} from "../../ui";
import { useRecordSave } from "../references/reference-form";
import { fetchPayers, payersKey, refreshClients } from "../subscribers/subscribers.api";
import {
  checkContractNumber,
  CONTRACTS_KEY,
  createContract,
  updateContract,
  uploadContractFile,
} from "./contracts.api";

const FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.webp";
const FILE_HINT = "PDF або зображення до 20 МБ";

interface ContractValues {
  payerId: string;
  number: string;
  signedOn: string;
  validUntil: string;
  terminatedOn?: string;
  note?: string;
  file?: File | null;
}

function checkFile(_: unknown, file: File | null | undefined) {
  if (file && file.size > CONTRACT_FILE_MAX_BYTES) return Promise.reject(new Error(CONTRACT_FILE_TEXT));
  return Promise.resolve();
}

interface SaveParams {
  subscriberId: string;
  row: Contract | null;
  values: ContractValues;
}

// A contract saved without its file is still saved: the form closes and says so, or a second try would ask to create a
// contract with a number that is already taken
async function saveContract({ subscriberId, row, values }: SaveParams): Promise<string | null> {
  const { file, ...fields } = values;
  const input = { ...fields, terminatedOn: fields.terminatedOn || null, note: fields.note || null };
  let id = row?.id;
  if (row) await updateContract(row.id, { ...input, version: row.version });
  else id = (await createContract(subscriberId, input)).id;
  if (!file || !id) return null;
  try {
    await uploadContractFile(id, file);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

// П7: the same number at this payer the database refuses, at another payer it is a warning with a link
function useNumberNote(payerId: string | undefined, typed: string | undefined, excludeId: string | undefined) {
  const number = useDebouncedValue(typed?.trim() ?? "");
  const check = useQuery({
    queryKey: [...CONTRACTS_KEY, "number-check", number, payerId, excludeId],
    queryFn: ({ signal }) => checkContractNumber({ number, payerId: payerId ?? "", excludeId }, signal),
    enabled: number.length > 0 && payerId !== undefined,
  });
  const holder = check.data?.samePayer ?? check.data?.otherPayer;
  if (!holder) return null;
  return (
    <>
      {check.data?.samePayer ? "Такий номер уже є в цього платника" : "Такий номер є в іншого платника"}:{" "}
      <EntityLink to={`/subscribers/${holder.subscriberId}?tab=contracts`} isNewTab>
        {holder.payerName}
      </EntityLink>
    </>
  );
}

interface ContractFormProps {
  subscriberId: string;
  row: Contract | null;
  open: boolean;
  onClose: () => void;
}

export function ContractForm({ subscriberId, row, open, onClose }: ContractFormProps) {
  const [form] = Form.useForm<ContractValues>();
  const { message } = App.useApp();
  const payerId = Form.useWatch("payerId", form);
  const number = Form.useWatch("number", form);
  const numberNote = useNumberNote(payerId, number, row?.id);
  const payers = useQuery({
    queryKey: payersKey(subscriberId),
    queryFn: ({ signal }) => fetchPayers(subscriberId, signal),
    enabled: open,
  });
  const options = useMemo(
    () =>
      (payers.data?.items ?? [])
        .filter((payer) => !payer.isArchived || payer.id === row?.payer.id)
        .map(({ id, name, isArchived }) => ({ value: id, label: name, isActive: !isArchived })),
    [payers.data, row],
  );
  const save = useRecordSave((values: ContractValues) => saveContract({ subscriberId, row, values }), {
    form,
    refresh: refreshClients,
    onDone: onClose,
    onSaved: (fileProblem) => {
      if (fileProblem) void message.error(`Договір збережено, але файл не завантажився: ${fileProblem}`);
    },
  });

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити договір ${row.number}` : "Новий договір"}
      open={open}
      onSubmit={(values) => save.submit(values)}
    >
      <Form.Item
        label="Платник"
        name="payerId"
        required
        initialValue={row?.payer.id}
        rules={[{ required: true, message: "Оберіть платника" }]}
      >
        <DictSelect options={options} isLoading={payers.isPending} hasError={payers.isError} />
      </Form.Item>
      <Form.Item
        label="Номер договору"
        name="number"
        required
        extra={numberNote}
        initialValue={row?.number}
        rules={[zodRule(contractNumberSchema)]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Дата підписання"
        name="signedOn"
        required
        initialValue={row?.signedOn}
        rules={[{ required: true, message: "Вкажіть дату підписання" }]}
      >
        <DateInput className="form-control-wide" />
      </Form.Item>
      <Form.Item
        label="Діє до"
        name="validUntil"
        required
        initialValue={row?.validUntil}
        rules={[{ required: true, message: "Вкажіть, до якої дати діє договір" }]}
      >
        <DateInput className="form-control-wide" />
      </Form.Item>
      <Form.Item label="Дата розірвання" name="terminatedOn" initialValue={row?.terminatedOn ?? undefined}>
        <DateInput className="form-control-wide" />
      </Form.Item>
      <Form.Item
        label="Примітка"
        name="note"
        initialValue={row?.note ?? undefined}
        rules={[zodRule(noteTextSchema.optional())]}
      >
        <Input.TextArea autoSize={{ minRows: 2 }} />
      </Form.Item>
      <Form.Item
        label="Файл договору"
        name="file"
        extra={row?.fileName ? `Зараз: ${row.fileName}. Новий файл замінить його в перегляді` : FILE_HINT}
        rules={[{ validator: checkFile }]}
      >
        <FileInput label="Файл договору" accept={FILE_TYPES} />
      </Form.Item>
    </FormModal>
  );
}
