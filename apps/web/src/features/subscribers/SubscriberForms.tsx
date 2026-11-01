import {
  moneyToText,
  parseMoneyToKop,
  subscriberCodeSchema,
  type SubscriberCard,
  type SubscriberCodeCheck,
} from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Form, Input } from "antd";
import { EntityLink, FactList, FormDrawer, FormModal, DateText, useDebouncedValue, zodRule } from "../../ui";
import { useRecordSave } from "../references/reference-form";
import { useManagerOptions } from "./subscriber-form";
import { SubscriberFields, type SubscriberValues } from "./SubscriberFields";
import {
  changeCode,
  changeTariff,
  checkCode,
  refreshClients,
  SUBSCRIBERS_KEY,
  updateSubscriber,
} from "./subscribers.api";
import { TariffFields } from "./TariffFields";

const ANSWER_FIELDS = { discountKop: "discount" };

interface CardFormProps {
  card: SubscriberCard;
  open: boolean;
  onClose: () => void;
}

export function SubscriberEditDrawer({ card, open, onClose }: CardFormProps) {
  const [form] = Form.useForm<SubscriberValues>();
  const managers = useManagerOptions(open, card.managerId, card.managerName);
  const save = useRecordSave((input: object) => updateSubscriber(card.id, input), {
    form,
    renamed: ANSWER_FIELDS,
    refresh: refreshClients,
    onDone: onClose,
  });

  return (
    <FormDrawer
      {...save.modal}
      title={`Змінити: ${card.name}`}
      open={open}
      onSubmit={({ discount, taxId, legacyCode, note, ...values }) =>
        save.submit({
          ...values,
          taxId: taxId || null,
          legacyCode: legacyCode || null,
          note: note || null,
          discountKop: parseMoneyToKop(discount) ?? 0,
          version: card.version,
        })
      }
    >
      <SubscriberFields managers={managers} initial={{ ...card, discount: moneyToText(card.discountKop) }} />
    </FormDrawer>
  );
}

interface TariffValues {
  programId: string;
  tariffId: string;
  validFrom: string;
}

export function TariffChangeModal({ card, open, onClose }: CardFormProps) {
  const [form] = Form.useForm<TariffValues>();
  const save = useRecordSave((input: TariffValues) => changeTariff(card.id, input), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });
  const [current] = card.tariffHistory;

  return (
    <FormModal {...save.modal} title="Змінити тариф" open={open} onSubmit={(values) => save.submit(values)}>
      {current && (
        <FactList
          items={[
            { label: "Зараз", value: `${current.tariffName}, ${current.serverName}` },
            { label: "Діє з", value: <DateText value={current.validFrom} /> },
          ]}
        />
      )}
      <TariffFields open={open} dateName="validFrom" initial={{ programId: card.programId }} />
      {card.tariffHistory.length > 1 && (
        <>
          <h3 className="form-section-title">Попередні версії</h3>
          <ul className="duplicates-list">
            {card.tariffHistory.slice(1).map((period) => (
              <li key={period.id}>
                {period.tariffName}, {period.serverName}: <DateText value={period.validFrom} /> -{" "}
                <DateText value={period.validTo} />
              </li>
            ))}
          </ul>
        </>
      )}
    </FormModal>
  );
}

function holderNote(check: SubscriberCodeCheck | undefined) {
  if (!check?.isValid || check.isFree) return null;
  if (!check.holder) return "Цей ID уже використовує інший клієнт";
  return (
    <>
      ID уже використовує клієнт{" "}
      <EntityLink to={`/subscribers/${check.holder.id}`} isNewTab>
        {check.holder.name}
      </EntityLink>
    </>
  );
}

interface CodeValues {
  code: string;
}

export function CodeChangeModal({ card, open, onClose }: CardFormProps) {
  const [form] = Form.useForm<CodeValues>();
  const typed = Form.useWatch("code", form);
  const code = useDebouncedValue(typed ?? "");
  const check = useQuery({
    queryKey: [...SUBSCRIBERS_KEY, "code-check", code, card.id],
    queryFn: ({ signal }) => checkCode(code, card.id, signal),
    enabled: open && code.length > 0,
  });
  const save = useRecordSave((input: CodeValues) => changeCode(card.id, { ...input, version: card.version }), {
    form,
    refresh: refreshClients,
    onDone: onClose,
  });

  return (
    <FormModal {...save.modal} title="Змінити ID" open={open} onSubmit={(values) => save.submit(values)}>
      <p className="form-note">Зараз ID {card.code}. Зміна запишеться в журнал, а попередній ID стане вільним.</p>
      <Form.Item
        label="Новий ID"
        name="code"
        required
        extra={holderNote(check.data)}
        rules={[zodRule(subscriberCodeSchema)]}
      >
        <Input inputMode="numeric" autoComplete="off" autoFocus />
      </Form.Item>
    </FormModal>
  );
}
