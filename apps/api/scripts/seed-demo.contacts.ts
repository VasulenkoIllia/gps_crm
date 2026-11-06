import { normalizeName, reverseDigits } from "@gps_crm/shared";
import type { ClientPlan } from "./seed-demo.data.ts";
import { ARCHIVE_COLUMNS, mobileOf, must, stamps, type Demo, type Moment, type Row } from "./seed-demo.model.ts";

// Contacts and payers of a client. Each contact has what its channel needs (contacts.md П4), each payer what its way
// of payment needs (payers.md П8): the forms take them on the next change.
const CONTACT_CODES = ["67", "50", "97", "63", "66", "73", "93"];
const SECOND_PHONE_EVERY = 3;
const SECOND_PHONE_SHIFT = 300;
const TELEGRAM_CHAT_FROM = 500_000_000;
const B2G_PAYMENT_TERMS = "Оплата протягом 10 банківських днів після акта";

interface Stamp {
  moment: Moment;
  actorId: string;
}

export function contactRow(
  demo: Demo,
  subscriberId: string,
  plan: ClientPlan,
  index: number,
  n: number,
  at: Stamp,
): Row {
  const contact = must(plan.contacts[index], "contact");
  const phone = mobileOf(must(CONTACT_CODES[n % CONTACT_CODES.length], "code"), n);
  const phone2 = index === 0 && n % SECOND_PHONE_EVERY === 0 ? mobileOf("95", n + SECOND_PHONE_SHIFT) : null;
  return demo.rows.add("contacts", {
    id: demo.ids(),
    subscriber_id: subscriberId,
    full_name: contact.name,
    full_name_norm: normalizeName(contact.name),
    position: contact.position ?? null,
    phone,
    phone_rev: reverseDigits(phone),
    phone2,
    phone2_rev: phone2 ? reverseDigits(phone2) : null,
    email: contact.channel === "email" ? `contact${n}@example.test` : null,
    telegram_chat_id: contact.channel === "telegram" ? String(TELEGRAM_CHAT_FROM + n * 7_919) : null,
    viber_chat_id: contact.channel === "viber" ? `demo${String(n).padStart(4, "0")}viber` : null,
    channel: contact.channel,
    crm_url: `https://crm.example.test/contacts/${n}`,
    is_primary: index === 0,
    billing_notify: true,
    tech_notify: !contact.isBillingOnly,
    is_active: true,
    note: null,
    ...stamps(at.moment, at.actorId),
    ...ARCHIVE_COLUMNS,
  });
}

// The payer «Новий клієнт» makes from the client itself: its name, its code, and the phone for IBAN details
export function payerRow(demo: Demo, plan: ClientPlan, taxId: string | null, phone: string, n: number, at: Stamp): Row {
  const isIban = plan.payment === "iban";
  return demo.rows.add("payers", {
    id: demo.ids(),
    name: plan.name,
    name_norm: normalizeName(plan.name),
    payment_method: plan.payment,
    legal_name: isIban ? null : plan.name,
    tax_id: taxId,
    vchasno_email: plan.payment === "vchasno" ? `buh${n}@example.test` : null,
    details_contact: isIban ? phone : null,
    payment_terms_note: plan.type === "B2G" ? B2G_PAYMENT_TERMS : null,
    note: null,
    ...stamps(at.moment, at.actorId),
    ...ARCHIVE_COLUMNS,
  });
}

export function linkPayer(demo: Demo, payerId: string, subscriberId: string, at: Stamp): void {
  demo.rows.add("payer_subscribers", {
    payer_id: payerId,
    subscriber_id: subscriberId,
    created_at: at.moment,
    created_by: at.actorId,
  });
}
