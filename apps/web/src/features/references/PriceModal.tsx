import { Form } from "antd";
import { FormModal } from "../../ui";
import { PriceFields } from "./PriceParts";
import { toDatedPrice, useReferenceSave } from "./reference-form";

interface PriceValues {
  amount: string;
  validFrom: string;
}

interface PriceModalProps {
  title: string;
  amountLabel: string;
  open: boolean;
  save: (input: { amountKop: number; validFrom: string }) => Promise<void>;
  onClose: () => void;
}

const ANSWER_FIELDS = { amountKop: "amount" };

// A new row at the end of a history, for an addon's price and for a cost alike (references.md П3)
export function PriceModal({ title, amountLabel, open, save, onClose }: PriceModalProps) {
  const [form] = Form.useForm<PriceValues>();
  const saving = useReferenceSave(save, { form, renamed: ANSWER_FIELDS, onDone: onClose });

  return (
    <FormModal
      {...saving.modal}
      title={title}
      submitLabel="Додати"
      open={open}
      onSubmit={(values) => saving.submit(toDatedPrice(values.amount, values.validFrom))}
    >
      <PriceFields amountLabel={amountLabel} autoFocus />
    </FormModal>
  );
}
