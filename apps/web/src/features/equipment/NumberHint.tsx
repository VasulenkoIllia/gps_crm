import { useQuery } from "@tanstack/react-query";
import { Alert } from "antd";
import type { EquipmentCheck } from "@gps_crm/shared";
import { EntityLink, useDebouncedValue } from "../../ui";
import { EQUIPMENT_KEY } from "./equipment.api";
import { checkOfTyped, hintOf } from "./number-check";

type CheckNumber = (value: string, excludeId: string, signal: AbortSignal) => Promise<EquipmentCheck>;

// Never from the cache: a tracker taken off an object a minute ago is free now, and the hint must say so (П6)
export function useNumberCheck(kind: string, value: string | undefined, check: CheckNumber, excludeId = "") {
  const typed = value?.trim() ?? "";
  const settled = useDebouncedValue(typed);
  const found = useQuery({
    queryKey: [...EQUIPMENT_KEY, "check", kind, settled, excludeId],
    queryFn: ({ signal }) => check(settled, excludeId, signal),
    enabled: settled.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
  return checkOfTyped(typed, settled, found.data);
}

interface NumberHintProps {
  result: EquipmentCheck | undefined;
  // On a form of an object a free record is what it takes; on a form of the equipment itself the number is simply taken
  isForInstallation?: boolean;
}

// equipment.md П1, objects.md §5: a hint while typing, with a link. The server has the last word on save.
export function NumberHint({ result, isForInstallation = false }: NumberHintProps) {
  const hint = hintOf(result, isForInstallation);
  if (!hint) return null;
  return (
    <Alert
      type={hint.type}
      showIcon
      className="form-alert"
      title={
        <>
          {hint.text}
          {hint.objectId && (
            <>
              {" "}
              <EntityLink to={`/objects/${hint.objectId}`} isNewTab>
                Відкрити об'єкт
              </EntityLink>
            </>
          )}
        </>
      }
    />
  );
}
