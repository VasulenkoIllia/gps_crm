import { createHash, randomUUID } from "node:crypto";
import { addDays, normalizeName } from "@gps_crm/shared";
import type { ContractPlan } from "./seed-demo.data.ts";
import {
  ARCHIVE_COLUMNS,
  contractPdf,
  stamps,
  text,
  type Demo,
  type DemoEvent,
  type Moment,
  type Row,
} from "./seed-demo.model.ts";
import type { Named } from "./seed-demo.references.ts";

// Contracts with their files: the file goes to the storage of core/files under a key of the same shape
// (files.repository.ts), and a contract keeps every file it had, the newest one shown (contracts.md)
const KEY_PREFIX_LENGTH = 2;
const TERMINATED_NOTE = "Розірваний за згодою сторін, укладено новий";

interface ContractOwner {
  id: string;
  managerId: string;
  contracts: Row[];
}

function contractEvent(action: DemoEvent["action"], contract: Row, details: DemoEvent["details"]): DemoEvent {
  return {
    action,
    entityType: "contract",
    entityId: text(contract, "id"),
    subscriberId: text(contract, "subscriber_id"),
    details: { label: text(contract, "number"), ...details },
  };
}

function addFile(demo: Demo, contract: Row, version: number, moment: Moment, actorId: string): string {
  const content = contractPdf([
    "DEMO CONTRACT (test data, not a real document)",
    `Signed on ${text(contract, "signed_on")}, valid until ${text(contract, "valid_until")}`,
    version === 0 ? "Draft for signing" : "Signed copy",
  ]);
  const fileId = randomUUID();
  const key = `contract/${fileId.slice(0, KEY_PREFIX_LENGTH)}/${fileId}`;
  const name = `Договір ${text(contract, "number").replaceAll("/", "-")}${version === 0 ? "" : " (підписаний)"}.pdf`;
  demo.files.push({ key, content });
  demo.rows.add("files", {
    id: demo.ids(),
    storage: "local",
    key,
    original_name: name,
    mime: "application/pdf",
    size: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    owner_type: "contract",
    owner_id: contract.id,
    uploaded_by: actorId,
    created_at: moment,
  });
  return name;
}

// «Додати договір» with its file, then each further file as an upload of its own
export function addContract(demo: Demo, owner: ContractOwner, plan: ContractPlan, payer: Named): void {
  const moment = demo.timeline.next();
  const signedOn = addDays(demo.today, -plan.signedAgo);
  const validUntil = addDays(signedOn, plan.days);
  const contract = demo.rows.add("contracts", {
    id: demo.ids(),
    subscriber_id: owner.id,
    payer_id: payer.id,
    number: plan.number,
    number_norm: normalizeName(plan.number),
    signed_on: signedOn,
    valid_until: validUntil,
    terminated_on: plan.terminatedAgo === undefined ? null : addDays(demo.today, -plan.terminatedAgo),
    note: plan.terminatedAgo === undefined ? null : TERMINATED_NOTE,
    ...stamps(moment, owner.managerId),
    ...ARCHIVE_COLUMNS,
  });
  owner.contracts.push(contract);
  const events = [contractEvent("contract.created", contract, { payer: payer.name, signedOn, validUntil })];
  if (plan.files > 0) {
    const fileName = addFile(demo, contract, 0, moment, owner.managerId);
    events.push(contractEvent("contract.file_uploaded", contract, { fileName }));
  }
  demo.journal.record(owner.managerId, events, moment);
  for (let version = 1; version < plan.files; version++) {
    const upload = demo.timeline.next();
    const fileName = addFile(demo, contract, version, upload, owner.managerId);
    demo.journal.record(owner.managerId, [contractEvent("contract.file_uploaded", contract, { fileName })], upload);
  }
}

// D92: a look at a file shows in «Журнал дій» only, not on a card or the home page
export function viewFirstFile(demo: Demo, contracts: Row[]): void {
  const file = demo.rows.of("files")[0];
  const contract = contracts.find((row) => row.id === file?.owner_id);
  if (!file || !contract) return;
  const event = contractEvent("contract.file_viewed", contract, { fileName: text(file, "original_name") });
  demo.journal.record(demo.admin.id, [event]);
}
