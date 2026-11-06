import {
  businessDateSchema,
  currentPrice,
  dateText,
  formatMoney,
  moneyTextSchema,
  nextPrice,
  parseMoneyToKop,
  todayKyiv,
  type PriceEntry,
} from "@gps_crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form } from "antd";
import { useState } from "react";
import { formatDate } from "../../lib/dayjs";
import {
  ConfirmAction,
  DateInput,
  DateText,
  DetailDrawer,
  EmptyValue,
  errorMessage,
  FactList,
  Money,
  MoneyInput,
  zodRule,
  type DataTableColumn,
  type Fact,
} from "../../ui";
import { defaultValidFrom } from "./reference-form";
import { refreshAfterChange } from "./references.api";

const IN_FORCE = "чинна";
const PLANNED = "запланована";
const DATE_REQUIRED = "Вкажіть дату";

export interface FirstCostValues {
  costAmount?: string;
  costValidFrom?: string;
}

// Optional at creation, and the date is needed only once there is a sum (10-fields.md розділ 8). From today: a new
// record usually works from the day it is added, and any other date is typed in (D87).
export function FirstCostFields({ label, dateLabel = "Собівартість діє з" }: { label: string; dateLabel?: string }) {
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
        label={dateLabel}
        name="costValidFrom"
        initialValue={todayKyiv()}
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
  // The first price of a new record is from today; a new one of a record that has a price, from the next month (П3)
  isFirst?: boolean;
}

export function PriceFields({ amountLabel, dateLabel = "Діє з", autoFocus, isFirst = false }: PriceFieldsProps) {
  return (
    <>
      <Form.Item label={amountLabel} name="amount" required rules={[zodRule(moneyTextSchema)]}>
        <MoneyInput autoFocus={autoFocus} />
      </Form.Item>
      <Form.Item
        label={dateLabel}
        name="validFrom"
        required
        initialValue={isFirst ? todayKyiv() : defaultValidFrom()}
        rules={[zodRule(businessDateSchema)]}
      >
        <DateInput className="form-control-wide" />
      </Form.Item>
    </>
  );
}

// What is planned after the price in force: the sum from its date, or a dash
export function NextPriceText({ history }: { history: PriceEntry[] | null }) {
  const next = nextPrice(history ?? [], todayKyiv());
  if (!next) return <EmptyValue />;
  return (
    <>
      <Money kop={next.amountKop} /> з <DateText value={next.validFrom} />
    </>
  );
}

// The sum in force with its date, and the planned one after it (D87). «Today» in the cell and not here: a list left
// open past midnight still shows the price of the new day.
export function priceColumns<T>(
  title: string,
  nextTitle: string,
  historyOf: (row: T) => PriceEntry[] | null,
): DataTableColumn<T>[] {
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
    { title: nextTitle, key: `${title}-next`, render: (_, row) => <NextPriceText history={historyOf(row)} /> },
  ];
}

function historyFacts(history: PriceEntry[], onRemove?: (entry: PriceEntry) => void): Fact[] {
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
          {onRemove && entry.validFrom > today && (
            <Button type="link" size="small" onClick={() => onRemove(entry)}>
              Видалити
            </Button>
          )}
        </>
      ),
    };
  });
}

export interface PriceHistoryBlock {
  title: string;
  history: PriceEntry[] | null;
  // A planned price of this block goes by this request (D87)
  remove?: (priceId: string) => Promise<void>;
  // The sum in the question before removal: «ціну», «собівартість», «вартість»
  noun?: string;
}

interface Removal {
  block: PriceHistoryBlock;
  entry: PriceEntry;
}

interface PriceHistoryDrawerProps {
  title: string;
  open: boolean;
  blocks: PriceHistoryBlock[];
  canChange: boolean;
  onClose: () => void;
}

// A refusal closes the question and says why: the history behind it may be out of date by now (midnight, say)
function useRemoval(onDone: () => void) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const mutation = useMutation({
    mutationFn: ({ block, entry }: Removal) => block.remove?.(entry.id) ?? Promise.resolve(),
    onSettled: () => {
      refreshAfterChange(client);
      setRemoval(null);
    },
    onSuccess: () => {
      void message.success("Заплановану видалено");
      onDone();
    },
    onError: (error) => void message.error(errorMessage(error)),
  });
  return { removal, setRemoval, mutation };
}

export function PriceHistoryDrawer({ title, open, blocks, canChange, onClose }: PriceHistoryDrawerProps) {
  const { removal, setRemoval, mutation } = useRemoval(onClose);
  return (
    <DetailDrawer title={title} open={open} onClose={onClose}>
      {blocks.map((block) => {
        if (block.history === null) return null;
        const onRemove = canChange && block.remove ? (entry: PriceEntry) => setRemoval({ block, entry }) : undefined;
        return (
          <section key={block.title}>
            <h2 className="sub-heading">{block.title}</h2>
            {block.history.length > 0 ? (
              <FactList items={historyFacts(block.history, onRemove)} />
            ) : (
              <p>Ще не вказано</p>
            )}
          </section>
        );
      })}
      <ConfirmAction
        title={`Видалити заплановану ${removal?.block.noun ?? "суму"}?`}
        consequence={
          removal
            ? `${removal.block.title} ${formatMoney(removal.entry.amountKop)} з ${dateText(removal.entry.validFrom)} ` +
              "не почне діяти. Запис про це лишиться в журналі."
            : ""
        }
        actionLabel="Видалити"
        open={removal !== null}
        isPending={mutation.isPending}
        onConfirm={() => removal && mutation.mutate(removal)}
        onClose={() => setRemoval(null)}
      />
    </DetailDrawer>
  );
}
