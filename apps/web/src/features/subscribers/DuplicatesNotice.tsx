import { DUPLICATE_FIELDS, normalizePhone, taxIdSchema, type DuplicatesQuery } from "@gps_crm/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Alert, Form } from "antd";
import { useMemo } from "react";
import { EntityLink, useDebouncedValue } from "../../ui";
import { fetchDuplicates, SUBSCRIBERS_KEY } from "./subscribers.api";

// A half-typed value finds nothing, so only what can match goes to the server
function queryOf(taxId?: string, phone?: string, crmUrl?: string, legacyCode?: string): DuplicatesQuery {
  return {
    taxId: taxIdSchema.safeParse(taxId).success ? taxId : undefined,
    phone: phone && normalizePhone(phone) ? phone : undefined,
    crmUrl: crmUrl?.trim() || undefined,
    legacyCode: legacyCode?.trim() || undefined,
  };
}

// К6: a match is a hint with a link, and never a refusal
export function DuplicatesNotice() {
  const form = Form.useFormInstance();
  const taxId = Form.useWatch("taxId", form) as string | undefined;
  const phone = Form.useWatch(["contact", "phone"], form) as string | undefined;
  const crmUrl = Form.useWatch("crmUrl", form) as string | undefined;
  const legacyCode = Form.useWatch("legacyCode", form) as string | undefined;
  const typed = useMemo(() => queryOf(taxId, phone, crmUrl, legacyCode), [taxId, phone, crmUrl, legacyCode]);
  const query = useDebouncedValue(typed);
  const hasValue = Object.values(query).some(Boolean);

  const found = useQuery({
    queryKey: [...SUBSCRIBERS_KEY, "duplicates", query],
    queryFn: ({ signal }) => fetchDuplicates(query, signal),
    enabled: hasValue,
    placeholderData: keepPreviousData,
  });
  const items = hasValue ? (found.data?.items ?? []) : [];
  if (items.length === 0) return null;

  return (
    <Alert
      type="warning"
      showIcon
      className="form-alert"
      title="Можливі дублікати"
      description={
        <ul className="duplicates-list">
          {items.map((item) => (
            <li key={`${item.field}-${item.id}`}>
              {DUPLICATE_FIELDS[item.field]}:{" "}
              <EntityLink to={`/subscribers/${item.id}`} isNewTab>
                {item.name}
              </EntityLink>{" "}
              (ID {item.code})
            </li>
          ))}
        </ul>
      }
    />
  );
}
