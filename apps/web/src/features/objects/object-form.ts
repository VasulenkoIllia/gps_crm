import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useReferenceOptions } from "../references/references.api";
import { fetchPayers, payersKey } from "../subscribers/subscribers.api";

export interface ObjectCreateValues {
  subscriberId?: string;
  payerId?: string;
  hasOwnTariff?: boolean;
  programId?: string;
  tariffId?: string;
  ownTariffFrom?: string;
  addons?: object[];
  sensors?: { serialNo: string; installedOn: string }[];
  note?: string;
}

// `subscriberId`: from the card of a client, where the form has no field for it
export function toObjectInput(values: ObjectCreateValues, subscriberId: string | undefined): object {
  const { hasOwnTariff, programId, tariffId, ownTariffFrom, addons, sensors, note, ...fields } = values;
  return {
    ...fields,
    subscriberId: subscriberId ?? values.subscriberId,
    ownTariff: hasOwnTariff ? { programId, tariffId, validFrom: ownTariffFrom } : undefined,
    addons: addons ?? [],
    sensors: (sensors ?? []).map(({ serialNo, installedOn }) => ({ sensor: { serialNo }, installedOn })),
    note: note || null,
  };
}

export function usePayerOptions(subscriberId: string | undefined, isEnabled: boolean) {
  const payers = useQuery({
    queryKey: payersKey(subscriberId ?? ""),
    queryFn: ({ signal }) => fetchPayers(subscriberId ?? "", signal),
    enabled: isEnabled && subscriberId !== undefined,
  });
  const items = payers.data?.items;
  const options = useMemo(
    () => (items ?? []).map(({ id, name, isArchived }) => ({ value: id, label: name, isActive: !isArchived })),
    [items],
  );
  return { options, isLoading: payers.isLoading, hasError: payers.isError && !items };
}

// objects.md П24: a service belongs to the programs it was made for
export function useAddonOptions(programId: string | undefined, isEnabled: boolean) {
  const addons = useReferenceOptions("addons", isEnabled);
  const options = useMemo(
    () =>
      (addons.items ?? [])
        .filter(({ programs }) => programs.some((program) => program.id === programId))
        .map(({ id, name, isActive }) => ({ value: id, label: name, isActive })),
    [addons.items, programId],
  );
  return { options, isLoading: addons.isLoading, hasError: addons.hasError };
}
