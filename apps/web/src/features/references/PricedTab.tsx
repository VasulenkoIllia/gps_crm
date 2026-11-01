import type { CostSubjectType, DatedPrice } from "@gps_crm/shared";
import { useCallback, useState, type ComponentType } from "react";
import { useCan } from "../../lib/session";
import type { DataTableColumn, RowAction } from "../../ui";
import { PriceModal } from "./PriceModal";
import { PriceHistoryDrawer, type PriceHistoryBlock } from "./PriceParts";
import { ReferenceTab, type RowFormProps, type TabProps } from "./ReferenceTab";
import { addCostPrice, type ReferenceItem } from "./references.api";

type PricedKind = "servers" | "addons" | "sim-plans";
type PricedAction = "edit" | "price" | "cost" | "history";

function actionWhen(isShown: boolean, key: PricedAction, label: string): RowAction<PricedAction>[] {
  return isShown ? [{ key, label }] : [];
}

interface PricedTabProps<K extends PricedKind> extends TabProps {
  kind: K;
  subjectType: CostSubjectType;
  labels: { cost: string; newCost: string; history: string };
  columns: DataTableColumn<ReferenceItem<K>>[];
  RowForm: ComponentType<RowFormProps<ReferenceItem<K>>>;
  historyBlocks: (row: ReferenceItem<K>) => PriceHistoryBlock[];
  // A price of sale, for what has one apart from its cost
  salePrice?: { label: string; save: (id: string, price: DatedPrice) => Promise<void> };
}

// A list whose rows carry a dated cost: the same menu and the same dialogs for servers, addons and SIM plans
export function PricedTab<K extends PricedKind>(props: PricedTabProps<K>) {
  const { kind, subjectType, labels, columns, RowForm, historyBlocks, salePrice } = props;
  const { isAdding, canManage, onAdd, onAddClosed } = props;
  const [editing, setEditing] = useState<ReferenceItem<K> | null>(null);
  const [priceOf, setPriceOf] = useState<ReferenceItem<K> | null>(null);
  const [costOf, setCostOf] = useState<ReferenceItem<K> | null>(null);
  const [historyOf, setHistoryOf] = useState<ReferenceItem<K> | null>(null);
  const canReadCost = useCan("cost.read");

  const actionsFor = useCallback(
    (row: ReferenceItem<K>, canEdit: boolean) => [
      ...actionWhen(canEdit, "edit", "Змінити"),
      ...actionWhen(canEdit && salePrice !== undefined, "price", "Нова ціна"),
      ...actionWhen(canEdit && canReadCost, "cost", labels.newCost),
      ...actionWhen(
        historyBlocks(row).some(({ history }) => history !== null),
        "history",
        labels.history,
      ),
    ],
    [canReadCost, historyBlocks, labels, salePrice],
  );
  const onAction = useCallback((action: PricedAction, row: ReferenceItem<K>) => {
    ({ edit: setEditing, price: setPriceOf, cost: setCostOf, history: setHistoryOf })[action](row);
  }, []);

  return (
    <>
      <ReferenceTab<K, PricedAction>
        kind={kind}
        columns={columns}
        canManage={canManage}
        onAdd={onAdd}
        actionsFor={actionsFor}
        onAction={onAction}
      />
      <RowForm
        row={editing}
        open={isAdding || editing !== null}
        onClose={() => {
          setEditing(null);
          onAddClosed();
        }}
      />
      {salePrice && (
        <PriceModal
          title={`Нова ціна: ${priceOf?.name ?? ""}`}
          amountLabel={salePrice.label}
          open={priceOf !== null}
          save={(price) => salePrice.save(priceOf?.id ?? "", price)}
          onClose={() => setPriceOf(null)}
        />
      )}
      <PriceModal
        title={`${labels.newCost}: ${costOf?.name ?? ""}`}
        amountLabel={labels.cost}
        open={costOf !== null}
        save={(price) => addCostPrice({ subjectType, subjectId: costOf?.id ?? "", ...price })}
        onClose={() => setCostOf(null)}
      />
      <PriceHistoryDrawer
        title={historyOf?.name ?? ""}
        open={historyOf !== null}
        blocks={historyOf ? historyBlocks(historyOf) : []}
        onClose={() => setHistoryOf(null)}
      />
    </>
  );
}
