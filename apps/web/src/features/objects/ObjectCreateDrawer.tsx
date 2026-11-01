import type { CreatedObject } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Form, type FormInstance } from "antd";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { DictSelect, FormDrawer } from "../../ui";
import { ContractorField, DeviceChoiceFields, PastDateField, SimChoiceFields } from "../equipment/EquipmentFields";
import { useRecordSave } from "../references/reference-form";
import { fetchSubscriber, refreshClients, subscriberKey } from "../subscribers/subscribers.api";
import { toObjectInput, usePayerOptions, type ObjectCreateValues } from "./object-form";
import { ObjectExtraFields, ObjectMainFields, ObjectTariffFields } from "./ObjectCreateFields";
import { createObject } from "./objects.api";

const ANSWER_FIELDS = {
  "ownTariff.programId": "programId",
  "ownTariff.tariffId": "tariffId",
  "ownTariff.validFrom": "ownTariffFrom",
};
// objects.md §5: the next object of the same client keeps the client, the tariff, the payer, the day and the contractor
const NEXT_OBJECT_CLEARS = [
  ["device", "imei"],
  ["device", "modelId"],
  ["sim", "iccid"],
  ["sim", "msisdn"],
  ["sim", "operatorId"],
  ["sim", "planId"],
  "name",
  "note",
  "addons",
  "sensors",
];
const FIRST_FIELD = ["device", "imei"];

// A client with one payer leaves nothing to choose. Not touched: opening the form and leaving it loses nothing.
function useOnlyPayer(
  form: FormInstance<ObjectCreateValues>,
  options: { value: string; isActive: boolean }[],
  open: boolean,
) {
  useEffect(() => {
    const live = options.filter(({ isActive }) => isActive);
    const [only] = live;
    if (live.length !== 1 || !only || form.getFieldValue("payerId")) return;
    form.setFields([{ name: "payerId", value: only.value, touched: false }]);
  }, [form, options, open]);
}

interface ObjectCreateDrawerProps {
  open: boolean;
  onClose: () => void;
  // From the card of a client: the client is settled
  subscriberId?: string;
}

export function ObjectCreateDrawer({ open, onClose, subscriberId }: ObjectCreateDrawerProps) {
  const [form] = Form.useForm<ObjectCreateValues>();
  const navigate = useNavigate();
  const chosenId = Form.useWatch("subscriberId", form);
  const clientId = subscriberId ?? chosenId;
  const hasOwnTariff = Form.useWatch("hasOwnTariff", form);
  const ownProgramId = Form.useWatch("programId", form);
  const client = useQuery({
    queryKey: subscriberKey(clientId ?? ""),
    queryFn: ({ signal }) => fetchSubscriber(clientId ?? "", signal),
    enabled: open && clientId !== undefined,
  });
  const payers = usePayerOptions(clientId, open);
  useOnlyPayer(form, payers.options, open);
  const save = useRecordSave((input: object): Promise<CreatedObject> => createObject(input), {
    form,
    renamed: ANSWER_FIELDS,
    clearFields: NEXT_OBJECT_CLEARS,
    firstField: FIRST_FIELD,
    isNew: true,
    addAnotherText: "Створити й додати ще",
    refresh: refreshClients,
    savedText: () => "Об'єкт створено",
    onDone: onClose,
    onSaved: ({ id }) => void navigate(`/objects/${id}`),
  });

  return (
    <FormDrawer
      {...save.modal}
      title="Новий об'єкт"
      submitLabel="Створити"
      open={open}
      onSubmit={(values, isAddingAnother) => save.submit(toObjectInput(values, subscriberId), isAddingAnother)}
    >
      <h3 className="form-section-title">Трекер</h3>
      <DeviceChoiceFields open={open} />
      <PastDateField label="Дата встановлення" name="installedOn" />
      <ContractorField open={open} />
      <h3 className="form-section-title">Об'єкт</h3>
      <ObjectMainFields open={open} isClientFixed={subscriberId !== undefined} />
      <h3 className="form-section-title">SIM-картка</h3>
      <SimChoiceFields open={open} />
      <h3 className="form-section-title">Тариф</h3>
      <ObjectTariffFields open={open} client={client.data} />
      <h3 className="form-section-title">Підключення</h3>
      <PastDateField label="Дата підключення" name="connectedOn" />
      <Form.Item
        label="Платник"
        name="payerId"
        required
        rules={[{ required: true, message: "Оберіть платника цього клієнта" }]}
      >
        <DictSelect options={payers.options} isLoading={payers.isLoading} hasError={payers.hasError} />
      </Form.Item>
      <h3 className="form-section-title">Додатково</h3>
      <ObjectExtraFields open={open} programId={hasOwnTariff ? ownProgramId : client.data?.programId} />
    </FormDrawer>
  );
}
