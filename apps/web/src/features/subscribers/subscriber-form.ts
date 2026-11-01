import { BILLING_MODELS, formatMoney, isTariffDateAllowed, todayKyiv, type Tariff } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo } from "react";
import { DATE_VALUE_FORMAT } from "../../lib/dayjs";
import { fetchManagers, MANAGERS_KEY } from "./subscribers.api";

// П25: the name of a tariff repeats, so what tells two apart has to be in the list itself (D54)
export function tariffLabel({ name, serverName, billingModel, priceKop }: Tariff): string {
  return `${name}, ${serverName}, ${BILLING_MODELS[billingModel].toLowerCase()}, ${formatMoney(priceKop)}`;
}

export function tariffOptionsOf(tariffs: Tariff[] | undefined, programId: string | undefined) {
  return (tariffs ?? [])
    .filter((tariff) => tariff.programId === programId)
    .map((tariff) => ({ value: tariff.id, label: tariffLabel(tariff), isActive: tariff.isActive }));
}

export function isTariffDateRefused(date: Dayjs): boolean {
  return !isTariffDateAllowed(dayjs(date).format(DATE_VALUE_FORMAT), todayKyiv());
}

// `chosen`: the manager of a card, who may be blocked by now and still has to read as a name
export function useManagerOptions(isEnabled: boolean, chosenId?: string, chosenName?: string) {
  const managers = useQuery({
    queryKey: MANAGERS_KEY,
    queryFn: ({ signal }) => fetchManagers(signal),
    enabled: isEnabled,
  });
  const items = managers.data?.items;
  const options = useMemo(() => {
    const active = (items ?? []).map(({ id, fullName }) => ({ value: id, label: fullName, isActive: true }));
    const isListed = !chosenId || active.some((option) => option.value === chosenId);
    return isListed ? active : [...active, { value: chosenId, label: chosenName ?? chosenId, isActive: false }];
  }, [items, chosenId, chosenName]);
  return { options, isLoading: managers.isPending, hasError: managers.isError && !items };
}
