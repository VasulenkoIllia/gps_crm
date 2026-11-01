import {
  noteTextSchema,
  payerNameSchema,
  payerTaxIdSchema,
  taxIdSchema,
  type Payer,
  type PaymentMethod,
} from "@gps_crm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import { EntityLink, errorMessage, FormModal, RemoteSelect, useDebouncedValue, zodRule } from "../../ui";
import { useReferenceSave } from "../references/reference-form";
import { PayerMethodFields, usePaymentTaxId } from "./PayerFields";
import {
  createPayer,
  linkPayer,
  refreshClients,
  searchPayerOptions,
  searchPayers,
  SUBSCRIBERS_KEY,
  updatePayer,
} from "./subscribers.api";

interface PayerValues {
  name: string;
  paymentMethod: PaymentMethod;
  taxId?: string;
  legalName?: string;
  vchasnoEmail?: string;
  detailsContact?: string;
  paymentTermsNote?: string;
  note?: string;
}

// A change carries the whole record (D59). The fields of another form of payment are off the form, and go with it
function wholeRecord(values: PayerValues) {
  return {
    ...values,
    taxId: values.taxId || null,
    legalName: values.legalName || null,
    vchasnoEmail: values.vchasnoEmail || null,
    detailsContact: values.detailsContact || null,
    paymentTermsNote: values.paymentTermsNote || null,
    note: values.note || null,
  };
}

interface MatchNoticeProps {
  subscriberId: string;
  excludeId?: string;
  onLinked: () => void;
}

// П9: the same tax number is a hint with a way to use that payer, and never a refusal
function PayerMatchNotice({ subscriberId, excludeId, onLinked }: MatchNoticeProps) {
  const client = useQueryClient();
  const typed = Form.useWatch("taxId") as string | undefined;
  const taxId = useDebouncedValue(typed ?? "");
  const found = useQuery({
    queryKey: [...SUBSCRIBERS_KEY, "payer-match", taxId],
    queryFn: ({ signal }) => searchPayers(taxId, signal),
    enabled: taxIdSchema.safeParse(taxId).success,
  });
  const link = useMutation({
    mutationFn: (payerId: string) => linkPayer(subscriberId, payerId),
    onSuccess: () => {
      refreshClients(client);
      onLinked();
    },
  });
  const match = found.data?.items.find((payer) => payer.taxId === taxId && payer.id !== excludeId);
  if (!match) return null;

  const [owner] = match.otherClients;
  return (
    <Alert
      type="warning"
      showIcon
      className="form-alert"
      title={`Платник із таким номером уже є: ${match.name}`}
      description={
        <>
          {owner && (
            <div>
              Клієнт:{" "}
              <EntityLink to={`/subscribers/${owner.id}`} isNewTab>
                {owner.name}
              </EntityLink>
            </div>
          )}
          {!excludeId && (
            <Button size="small" loading={link.isPending} onClick={() => link.mutate(match.id)}>
              Прив'язати наявного
            </Button>
          )}
          {link.error && <div className="field-hint">{errorMessage(link.error)}</div>}
        </>
      }
    />
  );
}

interface PayerFormProps {
  subscriberId: string;
  row: Payer | null;
  open: boolean;
  onClose: () => void;
}

export function PayerForm({ subscriberId, row, open, onClose }: PayerFormProps) {
  const [form] = Form.useForm<PayerValues>();
  const taxIdProblem = usePaymentTaxId("paymentMethod", form);
  const save = useReferenceSave(
    (input: object) => (row ? updatePayer(row.id, input) : createPayer(subscriberId, input)),
    { form, refresh: refreshClients, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : "Додати платника"}
      open={open}
      onSubmit={(values) => save.submit(row ? { ...wholeRecord(values), version: row.version } : wholeRecord(values))}
    >
      <PayerMatchNotice subscriberId={subscriberId} excludeId={row?.id} onLinked={save.modal.onClose} />
      <Form.Item label="Назва або ПІБ" name="name" required initialValue={row?.name} rules={[zodRule(payerNameSchema)]}>
        <Input autoComplete="off" autoFocus />
      </Form.Item>
      <Form.Item
        label="ЄДРПОУ / ІПН"
        name="taxId"
        required={Boolean(taxIdProblem)}
        initialValue={row?.taxId ?? undefined}
        rules={[
          { required: Boolean(taxIdProblem), message: taxIdProblem?.message },
          zodRule(payerTaxIdSchema.optional()),
        ]}
      >
        <Input inputMode="numeric" autoComplete="off" />
      </Form.Item>
      <PayerMethodFields initial={row ?? undefined} />
      <Form.Item
        label="Примітка"
        name="note"
        initialValue={row?.note ?? undefined}
        rules={[zodRule(noteTextSchema.optional())]}
      >
        <Input.TextArea autoSize={{ minRows: 2 }} />
      </Form.Item>
    </FormModal>
  );
}

interface PayerLinkFormProps {
  subscriberId: string;
  open: boolean;
  onClose: () => void;
}

export function PayerLinkModal({ subscriberId, open, onClose }: PayerLinkFormProps) {
  const [form] = Form.useForm<{ payerId: string }>();
  const save = useReferenceSave((payerId: string) => linkPayer(subscriberId, payerId), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });

  return (
    <FormModal
      {...save.modal}
      title="Прив'язати наявного платника"
      submitLabel="Прив'язати"
      open={open}
      onSubmit={({ payerId }) => save.submit(payerId)}
    >
      <Form.Item
        label="Платник: назва або ЄДРПОУ"
        name="payerId"
        required
        rules={[{ required: true, message: "Оберіть платника" }]}
      >
        <RemoteSelect name="payers" search={searchPayerOptions} className="form-control-wide" />
      </Form.Item>
    </FormModal>
  );
}
