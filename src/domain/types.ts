// Domain model of the GPS subscriber accounting system.
// Shared by the demo (mock data) and intended as the base for the real API contracts.

export type ID = string;
/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** Timestamp, ISO 8601. */
export type IsoDateTime = string;

export type SubscriberType = "B2B" | "B2C" | "B2G";
export type ObjectStatus = "active" | "suspended" | "disconnected";
/** Subscriber status is derived from its objects; `partial` = some objects suspended. */
export type SubscriberStatus = ObjectStatus | "partial";
export type Channel = "telegram" | "viber" | "email";
export type PaymentMethod = "invoice" | "iban" | "card" | "cash";
export type TariffPeriod = "month" | "year";
export type RoleId = "admin" | "manager" | "tech";

export interface User {
  id: ID;
  name: string;
  role: RoleId;
}

/** Monitoring platform (Unitrack / Forguard / Ruhavik). Future integration adapter boundary. */
export interface Program {
  id: ID;
  name: string;
  /** Cost of hosting one object on the platform, UAH / month. */
  placementCost: number;
}

export interface MonitoringServer {
  id: ID;
  programId: ID;
  name: string;
  /** Overrides program placement cost when set. */
  placementCost?: number;
}

export interface Tariff {
  id: ID;
  programId: ID;
  name: string;
  period: TariffPeriod;
  price: number;
}

export interface Addon {
  id: ID;
  name: string;
  /** UAH / month. */
  price: number;
  programIds: ID[];
}

export interface TrackerModel {
  id: ID;
  vendor: string;
  name: string;
}

export interface SimPlan {
  id: ID;
  operator: string;
  name: string;
  monthlyCost: number;
}

export interface DisconnectReason {
  id: ID;
  name: string;
}

export interface Subscriber {
  id: ID;
  /** Human-readable auto-generated code, e.g. AB-00012. */
  code: string;
  type: SubscriberType;
  name: string;
  /** ЄДРПОУ (8 digits) or ІПН (10 digits). */
  taxId?: string;
  crmUrl: string;
  managerId: ID;
  createdAt: IsoDate;
  note?: string;
}

export interface Contact {
  id: ID;
  subscriberId: ID;
  fullName: string;
  position?: string;
  phone: string;
  phone2?: string;
  email?: string;
  telegramChatId?: string;
  viberChatId?: string;
  channel: Channel;
  isPrimary: boolean;
  billingNotify: boolean;
  techNotify: boolean;
  active: boolean;
  crmUrl: string;
  note?: string;
}

/** Legal payer. One subscriber can have several; each object is billed to one payer. */
export interface Payer {
  id: ID;
  subscriberId: ID;
  name: string;
  taxId?: string;
  iban?: string;
  method: PaymentMethod;
}

export interface Contract {
  id: ID;
  subscriberId: ID;
  payerId: ID;
  number: string;
  signedAt: IsoDate;
  validUntil?: IsoDate;
  autoRenew: boolean;
  fileName?: string;
}

export type DeviceStatus = "installed" | "in_stock" | "repair" | "written_off" | "dismantled";
export type DeviceOwnership = "sold" | "rent";

export interface Device {
  id: ID;
  imei: string;
  modelId?: ID;
  status: DeviceStatus;
  ownership: DeviceOwnership;
  objectId?: ID;
}

export type SimStatus = "active" | "in_stock" | "blocked";

export interface Sim {
  id: ID;
  iccid: string;
  msisdn: string;
  planId: ID;
  status: SimStatus;
  deviceId?: ID;
}

export interface Sensor {
  id: ID;
  sn: string;
  kind: string;
  objectId?: ID;
}

/** Monitored object (vehicle / machine). Lives independently of the tracker installed in it. */
export interface GpsObject {
  id: ID;
  subscriberId: ID;
  payerId: ID;
  name: string;
  plate?: string;
  deviceId?: ID;
  simId?: ID;
  programId: ID;
  serverId: ID;
  tariffId: ID;
  addonIds: ID[];
  /** Fixed discount, UAH / month. */
  discount: number;
  status: ObjectStatus;
  connectedAt: IsoDate;
  disconnectedAt?: IsoDate;
  disconnectReasonId?: ID;
  /** Demo billing model assumption: service is paid up to this date inclusive. */
  paidUntil: IsoDate;
  note?: string;
}

export interface Payment {
  id: ID;
  subscriberId: ID;
  payerId: ID;
  invoiceNo?: string;
  amount: number;
  paidAt: IsoDate;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  objectIds: ID[];
  method: PaymentMethod;
  createdBy: ID;
}

export type AuditEntity = "subscriber" | "object" | "payment" | "contact" | "device" | "mailing";

export interface AuditEntry {
  id: ID;
  at: IsoDateTime;
  userId: ID;
  entity: AuditEntity;
  entityId: ID;
  subscriberId?: ID;
  action: string;
  details?: string;
}

export type TemplateKind = "reminder" | "debt" | "invoice" | "info" | "tech";

export interface MessageTemplate {
  id: ID;
  name: string;
  kind: TemplateKind;
  subject?: string;
  body: string;
}

export interface AutoRule {
  id: ID;
  name: string;
  description: string;
  templateId: ID;
  enabled: boolean;
  schedule: string;
}

export interface Mailing {
  id: ID;
  createdAt: IsoDateTime;
  userId: ID;
  templateId: ID;
  audience: string;
  byChannel: Record<Channel, number>;
  skipped: number;
}
