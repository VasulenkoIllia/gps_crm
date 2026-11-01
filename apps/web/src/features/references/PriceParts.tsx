import {
  businessDateSchema,
  currentPrice,
  moneyTextSchema,
  nextPrice,
  parseMoneyToKop,
  todayKyiv,
  type PriceEntry,
} from "@gps_crm/shared";
import { Form } from "antd";
import { formatDate } from "../../lib/dayjs";
import {
  DateInput,
  DateText,
  DetailDrawer,
  FactList,
  Money,
  MoneyInput,
  zodRule,
  type DataTableColumn,
  type Fact,
} from "../../ui";
import { defaultValidFrom } from "./reference-form";

const IN_FORCE = "чинна";
const PLANNED = "запланована";
const DATE_REQUIRED = "Вкажіть дату";

export interface FirstCostValues {
  costAmount?: string;
  costValidFrom?: string;
}

// Optional at creation, and the date is needed only once there is a sum (10-fields.md розділ 8)
export function FirstCostFields({ label }: { label: string }) {
  return (
    <>
      <Form.Item
        label={label}
        name="costAmount"
        rules={[
          {
            validator: (_, value: string | undefined) =>
              value && !moneyTextSchema.safeParse(value).success
                ? Promise.reject(new Error("Вкажіть суму більше нуля"))
                : Promise.resolve(),
          },
        ]}
      >
        <MoneyInput />
      </Form.Item>
      <Form.Item
        label="Собівартість діє з"
        name="costValidFrom"
        initialValue={defaultValidFrom()}
        dependencies={["costAmount"]}
        rules={[
          ({ getFieldValue }) => ({
            validator: (_, value: string | undefined) =>
              getFieldValue("costAmount") && !businessDateSchema.safeParse(value).success
                ? Promise.reject(new Error(DATE_REQUIRED))
                : Promise.resolve(),
          }),
        ]}
      >
        <DateInput className="form-control-wide" />
      </Form.Item>
    </>
  );
}

export function firstCostOf(values: FirstCostValues) {
  const amountKop = parseMoneyToKop(values.costAmount ?? "");
  if (!amountKop || !values.costValidFrom) return {};
  return { firstCost: { amountKop, validFrom: values.costValidFrom } };
}

interface PriceFieldsProps {
  amountLabel: string;
  dateLabel?: string;
  autoFocus?: boolean;
}

export function PriceFields({ amountLabel, dateLabel = "Діє з", autoFocus }: PriceFieldsProps) {
  return (
    <>
      <Form.Item label={amountLabel} name="amount" required rules={[zodRule(moneyTextSchema)]}>
        <MoneyInput autoFocus={autoFocus} />
      </Form.Item>
      <Form.Item
        label={dateLabel}
        name="validFrom"
        required
        initialValue={defaultValidFrom()}
        rules={[zodRule(businessDateSchema)]}
      >
        <DateInput className="form-control-wide" />
      </Form.Item>
    </>
  );
}

// «Вартість» and «Діє з» of a list: what stands today, whatever is planned after it. «Today» in the cell and not here:
// a list left open past midnight still shows the price of the new day.
export function priceColumns<T>(title: string, historyOf: (row: T) => PriceEntry[] | null): DataTableColumn<T>[] {
  return [
    {
      title,
      key: `${title}-amount`,
      align: "right",
      render: (_, row) => <Money kop={currentPrice(historyOf(row) ?? [], todayKyiv())?.amountKop} />,
    },
    {
      title: "Діє з",
      key: `${title}-from`,
      render: (_, row) => <DateText value={currentPrice(historyOf(row) ?? [], todayKyiv())?.validFrom} />,
    },
  ];
}

function historyFacts(history: PriceEntry[]): Fact[] {
  const today = todayKyiv();
  const inForce = currentPrice(history, today);
  const planned = nextPrice(history, today);
  return [...history].reverse().map((entry) => {
    const mark = entry.id === inForce?.id ? IN_FORCE : entry.id === planned?.id ? PLANNED : null;
    return {
      label: formatDate(entry.validFrom),
      value: (
        <>
          <Money kop={entry.amountKop} />
          {mark && ` (${mark})`}
        </>
      ),
    };
  });
}

export interface PriceHistoryBlock {
  title: string;
  history: PriceEntry[] | null;
}

interface PriceHistoryDrawerProps {
  title: string;
  open: boolean;
  blocks: PriceHistoryBlock[];
  onClose: () => void;
}

export function PriceHistoryDrawer({ title, open, blocks, onClose }: PriceHistoryDrawerProps) {
  return (
    <DetailDrawer title={title} open={open} onClose={onClose}>
      {blocks.map(({ title: blockTitle, history }) =>
        history === null ? null : (
          <section key={blockTitle}>
            <h2 className="sub-heading">{blockTitle}</h2>
            {history.length > 0 ? <FactList items={historyFacts(history)} /> : <p>Ще не вказано</p>}
          </section>
        ),
      )}
    </DetailDrawer>
  );
}
