import { ARCHIVED_STATUS_META, CONTRACT_EXPIRING_META, CONTRACT_STATUS_META, type Contract } from "@gps_crm/shared";
import { EmptyValue, ExternalLink, StatusTag } from "../../ui";
import { contractFileUrl } from "./contracts.api";

export function ContractStatus({ contract }: { contract: Contract }) {
  return (
    <>
      <StatusTag status={contract.isArchived ? ARCHIVED_STATUS_META : CONTRACT_STATUS_META[contract.status]} />
      {contract.isExpiring && !contract.isArchived && <StatusTag status={CONTRACT_EXPIRING_META} />}
    </>
  );
}

export function ContractFile({ contract }: { contract: Contract }) {
  if (!contract.fileName) return <EmptyValue />;
  return <ExternalLink href={contractFileUrl(contract.id)}>{contract.fileName}</ExternalLink>;
}
