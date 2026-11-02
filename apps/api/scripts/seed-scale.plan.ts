import type { WordList } from "./seed-scale.words.js";

// The volumes of 06-quality.md §6.1 for a given number of clients. Everything else grows with the clients, so a small
// run (`--clients 10000`) is the same database a hundred times smaller.
export interface Plan {
  clients: number;
  // The first fifth of the clients hold every object past the first one each: the rest have one object
  multiObjectClients: number;
  // Objects of the 50 large fleets, among the extra ones
  fleetObjects: number;
  objects: number;
  devices: number;
  sims: number;
  contacts: number;
  payers: number;
  contracts: number;
  sensors: number;
  sensorsInstalled: number;
  events: number;
}

export const DEFAULT_CLIENTS = 1_000_000;
// The seed series of ID (D35): seven digits, never met by the five-digit ID of real clients
export const SEED_CODE_FROM = 1_000_000;
export const SEED_CODE_TO = 2_999_999;
const CLIENTS_STEP = 1_000;
const CLIENTS_MIN = 10_000;
const CLIENTS_MAX = SEED_CODE_TO - SEED_CODE_FROM + 1 - CLIENTS_MIN;

// A whole number of thousands keeps the multipliers of the SQL (7919, 104729) coprime with every modulus they meet,
// so the numbers they spread stay unique
export function planFor(clients: number): Plan {
  if (!Number.isInteger(clients) || clients % CLIENTS_STEP !== 0 || clients < CLIENTS_MIN || clients > CLIENTS_MAX) {
    throw new Error(`--clients takes thousands from ${CLIENTS_MIN} to ${CLIENTS_MAX}, not ${clients}`);
  }
  const share = (ratio: number) => Math.round(clients * ratio);
  return {
    clients,
    multiObjectClients: share(0.2),
    fleetObjects: share(0.1),
    objects: share(2.5),
    devices: share(2.7),
    sims: share(2.7),
    contacts: share(1.5),
    payers: share(1.2),
    contracts: share(0.4),
    sensors: share(0.2),
    sensorsInstalled: share(0.12),
    events: share(5),
  };
}

export interface Statement {
  text: string;
  values?: unknown[];
}

export interface Step {
  name: string;
  // Rows of the step's counter, for the dry run and the progress
  rows: (plan: Plan) => number;
  // A large step goes in chunks of its counter, each in a transaction of its own with its mark in seed.progress, so a
  // run that stopped goes on from the last chunk instead of the start
  chunk?: number;
  // VACUUM refuses a transaction
  isOutsideTransaction?: boolean;
  sql: (plan: Plan, from: number, to: number) => Statement[];
}

// Puts the word lists into the parameters of one statement: a list is picked from by an expression of the row number
export class Sql {
  readonly values: unknown[] = [];

  word(list: WordList, form: keyof WordList, index: string): string {
    this.values.push(list[form]);
    return `($${this.values.length}::text[])[1 + ((${index}) % ${list[form].length})]`;
  }

  statement(text: string): Statement {
    return { text, values: [...this.values] };
  }
}

// A one-off statement with no parameters
export const sql = (text: string): Statement => ({ text });
