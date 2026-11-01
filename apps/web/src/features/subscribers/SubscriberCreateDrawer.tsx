import { parseMoneyToKop, type CreatedSubscriber, type SubscriberType } from "@gps_crm/shared";
import { Form, type FormInstance } from "antd";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useCurrentUser } from "../../lib/session";
import { FormDrawer } from "../../ui";
import { useRecordSave } from "../references/reference-form";
import { ContactChannelFields, ContactMainFields } from "./ContactFields";
import { DuplicatesNotice } from "./DuplicatesNotice";
import { PayerMethodFields } from "./PayerFields";
import { useManagerOptions } from "./subscriber-form";
import { SubscriberFields, type SubscriberValues } from "./SubscriberFields";
import { createSubscriber, refreshClients } from "./subscribers.api";
import { TariffFields } from "./TariffFields";

const ANSWER_FIELDS = { discountKop: "discount" };
const FIRST_CONTACT_NAME = ["contact", "fullName"];

interface CreateValues extends SubscriberValues {
  programId: string;
  tariffId: string;
  tariffValidFrom: string;
  contact: object;
  payer: object;
}

function createdText({ code }: CreatedSubscriber): string {
  return `Клієнта створено, ID ${code}`;
}

function toInput({ discount, ...values }: CreateValues): object {
  return { ...values, discountKop: parseMoneyToKop(discount) ?? 0 };
}

// contacts.md §11: a person is usually their own contact. What was typed there by hand stays, and that is told by the
// value: setFieldValue marks a field as touched, so the touched flag cannot say who wrote it
function useFirstContactName(form: FormInstance<CreateValues>, type: SubscriberType | undefined) {
  const name = Form.useWatch("name", form) as string | undefined;
  const lastFilled = useRef<string>(undefined);
  useEffect(() => {
    const field = FIRST_CONTACT_NAME as never;
    const contactName = form.getFieldValue(field) as string | undefined;
    if (type !== "B2C" || !name || (contactName && contactName !== lastFilled.current)) return;
    form.setFieldValue(field, name);
    lastFilled.current = name;
  }, [form, type, name]);
}

export function SubscriberCreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<CreateValues>();
  const navigate = useNavigate();
  const me = useCurrentUser().data;
  const managers = useManagerOptions(open);
  const type = Form.useWatch("type", form) as SubscriberType | undefined;
  useFirstContactName(form, type);
  const save = useRecordSave((input: object) => createSubscriber(input), {
    form,
    renamed: ANSWER_FIELDS,
    isNew: true,
    addAnotherText: "Створити й додати ще",
    refresh: refreshClients,
    savedText: createdText,
    onDone: onClose,
    onSaved: ({ id }) => void navigate(`/subscribers/${id}`),
  });

  return (
    <FormDrawer
      {...save.modal}
      title="Новий клієнт"
      submitLabel="Створити"
      open={open}
      onSubmit={(values, isAddingAnother) => save.submit(toInput(values), isAddingAnother)}
    >
      <p className="form-note">ID система присвоїть сама, із серії за типом клієнта.</p>
      <DuplicatesNotice />
      <SubscriberFields managers={managers} initial={{ managerId: me?.id }} />
      <h3 className="form-section-title">Тариф</h3>
      <TariffFields open={open} dateName="tariffValidFrom" />
      <h3 className="form-section-title">Контактна особа</h3>
      <ContactMainFields prefix={["contact"]} />
      <ContactChannelFields prefix={["contact"]} />
      <h3 className="form-section-title">Перший платник</h3>
      <p className="form-note">
        {type === "B2C" ? "ПІБ платника" : "Назва платника"} і податковий номер братимуться з даних клієнта.
      </p>
      <PayerMethodFields prefix={["payer"]} />
    </FormDrawer>
  );
}
