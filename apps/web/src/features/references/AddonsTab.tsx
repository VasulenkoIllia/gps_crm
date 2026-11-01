import { currentPrice, nextPrice, PROGRAM_REQUIRED, referenceNameSchema, todayKyiv, type Addon } from "@gps_crm/shared";
import { Form, Input } from "antd";
import { useCan } from "../../lib/session";
import { DateText, DictSelect, EmptyValue, FormModal, Money, zodRule, type DataTableColumn } from "../../ui";
import { PricedTab } from "./PricedTab";
import { FirstCostFields, firstCostOf, PriceFields, type FirstCostValues } from "./PriceParts";
import type { RowFormProps, TabProps } from "./ReferenceTab";
import { toDatedPrice, useReferenceSave } from "./reference-form";
import { REFERENCE_TEXTS } from "./reference-texts";
import { addAddonPrice, createReference, updateReference, useReferenceOptions } from "./references.api";

const PRICE_LABEL = "Ціна за місяць";
const COST_LABEL = "Собівартість";
const LABELS = { cost: COST_LABEL, newCost: "Нова собівартість", history: "Історія цін" };
const SALE_PRICE = { label: PRICE_LABEL, save: addAddonPrice };
const historyBlocks = (row: Addon) => [
  { title: "Ціна", history: row.prices },
  { title: COST_LABEL, history: row.costs },
];

interface AddonValues extends FirstCostValues {
  name: string;
  programIds: string[];
  amount: string;
  validFrom: string;
}

function AddonForm({ row, open, onClose }: RowFormProps<Addon>) {
  const [form] = Form.useForm<AddonValues>();
  const canReadCost = useCan("cost.read");
  const programs = useReferenceOptions("programs", open);
  const save = useReferenceSave(
    (input: object) => (row ? updateReference("addons", row.id, input) : createReference("addons", input)),
    { form, clearFields: ["name", "amount", "costAmount"], isNew: !row, onDone: onClose },
  );

  return (
    <FormModal
      {...save.modal}
      title={row ? `Змінити: ${row.name}` : REFERENCE_TEXTS.addons.add}
      open={open}
      onSubmit={(values, isAddingAnother) => {
        const input = { name: values.name, programIds: values.programIds };
        const created = { price: toDatedPrice(values.amount, values.validFrom), ...firstCostOf(values) };
        save.submit(row ? { ...input, version: row.version } : { ...input, ...created }, isAddingAnother);
      }}
    >
      <Form.Item label="Назва" name="name" required initialValue={row?.name} rules={[zodRule(referenceNameSchema)]}>
        <Input autoComplete="off" autoFocus />
      </Form.Item>
      <Form.Item
        label="Для яких програм"
        name="programIds"
        required
        initialValue={row?.programs.map(({ id }) => id)}
        rules={[{ required: true, message: PROGRAM_REQUIRED }]}
      >
        <DictSelect<string[]>
          isMultiple
          options={programs.options}
          isLoading={programs.isLoading}
          hasError={programs.hasError}
        />
      </Form.Item>
      {!row && <PriceFields amountLabel={PRICE_LABEL} />}
      {!row && canReadCost && <FirstCostFields label={COST_LABEL} />}
    </FormModal>
  );
}

// «Today» in the cell and not above it: a list left open past midnight still shows the price of the new day
const COLUMNS: DataTableColumn<Addon>[] = [
  { title: "Назва", dataIndex: "name" },
  {
    title: "Програми",
    key: "programs",
    render: (_, row) => row.programs.map(({ name }) => name).join(", ") || <EmptyValue />,
  },
  {
    title: PRICE_LABEL,
    key: "price",
    align: "right",
    render: (_, row) => <Money kop={currentPrice(row.prices, todayKyiv())?.amountKop} />,
  },
  {
    title: "Діє з",
    key: "from",
    render: (_, row) => <DateText value={currentPrice(row.prices, todayKyiv())?.validFrom} />,
  },
  {
    title: "Наступна ціна",
    key: "next",
    render: (_, row) => {
      const next = nextPrice(row.prices, todayKyiv());
      if (!next) return <EmptyValue />;
      return (
        <>
          <Money kop={next.amountKop} /> з <DateText value={next.validFrom} />
        </>
      );
    },
  },
];

export function AddonsTab(tab: TabProps) {
  return (
    <PricedTab
      {...tab}
      kind="addons"
      subjectType="addon"
      labels={LABELS}
      columns={COLUMNS}
      RowForm={AddonForm}
      historyBlocks={historyBlocks}
      salePrice={SALE_PRICE}
    />
  );
}
