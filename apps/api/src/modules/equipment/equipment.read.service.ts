import type {
  AvailableQuery,
  DeviceCard,
  DeviceList,
  DeviceListQuery,
  EquipmentCheck,
  SensorList,
  SensorListQuery,
  SimCard,
  SimList,
  SimListQuery,
} from "@gps_crm/shared";
import type { AppDeps } from "../../core/deps.js";
import { notFound } from "../references/index.js";
import * as cards from "./equipment.card.queries.js";
import * as queries from "./equipment.queries.js";

type ReadDeps = Pick<AppDeps, "db">;

export function listDevices(deps: ReadDeps, query: DeviceListQuery): Promise<DeviceList> {
  return queries.listDevices(deps.db, query);
}

export function listSims(deps: ReadDeps, query: SimListQuery): Promise<SimList> {
  return queries.listSims(deps.db, query);
}

export function listSensors(deps: ReadDeps, query: SensorListQuery): Promise<SensorList> {
  return queries.listSensors(deps.db, query);
}

export function listFreeDevices(deps: ReadDeps, query: AvailableQuery): Promise<DeviceList> {
  return queries.listAvailableDevices(deps.db, query);
}

export function listFreeSims(deps: ReadDeps, query: AvailableQuery): Promise<SimList> {
  return queries.listAvailableSims(deps.db, query);
}

export function listFreeSensors(deps: ReadDeps, query: AvailableQuery): Promise<SensorList> {
  return queries.listAvailableSensors(deps.db, query);
}

export async function readDeviceCard(deps: ReadDeps, id: string): Promise<DeviceCard> {
  const card = await cards.getDeviceCard(deps.db, id);
  if (!card) throw notFound();
  return card;
}

export async function readSimCard(deps: ReadDeps, id: string, canReadCost: boolean): Promise<SimCard> {
  const card = await cards.getSimCard(deps.db, id, canReadCost);
  if (!card) throw notFound();
  return card;
}

export function checkImei(deps: ReadDeps, value: string, excludeId: string | undefined): Promise<EquipmentCheck> {
  return cards.checkImei(deps.db, value, excludeId);
}

export function checkIccid(deps: ReadDeps, value: string, excludeId: string | undefined): Promise<EquipmentCheck> {
  return cards.checkIccid(deps.db, value, excludeId);
}
