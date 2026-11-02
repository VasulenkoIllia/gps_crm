import { homeSchema, type Home } from "@gps_crm/shared";
import { apiGet } from "../../lib/api";

export const HOME_KEY = ["home"];

export function fetchHome(signal: AbortSignal): Promise<Home> {
  return apiGet("/home", homeSchema, signal);
}

export function countText({ count, isCapped }: { count: number; isCapped: boolean }): string {
  const number = count.toLocaleString("uk-UA");
  return isCapped ? `понад ${number}` : number;
}
