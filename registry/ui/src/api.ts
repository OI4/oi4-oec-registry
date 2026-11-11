// The HTTP API of the OEC Registry (api/openapi.json, ADR-0029 §9, ADR-0035).
// Everything comes from the origin of the page: /api/assets/{il} and the
// event stream /api/stream; nothing is loaded from anywhere else. The session
// is the HttpOnly cookie of POST /api/login – the token of the answer is not
// kept by the page.

export interface LocalizedText {
  Locale: string;
  Text: string;
}

export interface Mam {
  Manufacturer: LocalizedText;
  ManufacturerUri: string;
  Model: LocalizedText;
  ProductCode: string;
  HardwareRevision: string;
  SoftwareRevision: string;
  DeviceRevision: string;
  DeviceManual: string;
  DeviceClass: string;
  SerialNumber: string;
  ProductInstanceUri: string;
  RevisionCounter: number;
  Description?: LocalizedText;
  GlobalAssetId?: string;
}

export type HealthState =
  | "NORMAL_0"
  | "FAILURE_1"
  | "CHECK_FUNCTION_2"
  | "OFF_SPEC_3"
  | "MAINTENANCE_REQUIRED_4";

export interface HealthDetail {
  Health: HealthState;
  DiagnosticCode?: string;
  Location?: string;
  Description?: string;
}

export interface Health {
  Health: HealthState;
  HealthScore?: number;
  Details?: HealthDetail[];
}

export interface Observed {
  level: number;
  missing: string[];
}

export interface Conformity {
  messages: number;
  violations: number;
}

export type Availability = "online" | "offlineGraceful" | "offlineUngraceful";

export interface Summary {
  il: string;
  kind: "application" | "device";
  serviceType: string;
  publisher: string;
  availability: Availability;
  available: boolean;
  firstSeen: number;
  lastSeen: number;
  onlineSince: number | null;
  mam: Mam | null;
  health: Health | null;
  observed: Observed | null;
  devices: string[];
  conformity: Conformity | null;
}

export interface Answer {
  outcome: "answered" | "timeout" | "refused";
  reason?: string;
}

export interface PublicationEntry {
  Resource: string;
  Source: string;
  Filter?: string;
  DataSetWriterId: number;
  Mode?: string;
  Interval?: number;
  Config?: string;
}

export interface SubscriptionEntry {
  TopicPath: string;
  Interval?: number;
  Config?: string;
}

export interface Violation {
  at: number;
  topic: string;
  reqs: string[];
  message: string;
}

export interface Asset extends Summary {
  healthHistory: { at: number; health: Health }[];
  profile: string[] | null;
  answers: Partial<Record<string, Answer>>;
  publications: PublicationEntry[] | null;
  subscriptions: SubscriptionEntry[] | null;
  violations: Violation[] | null;
}

export interface OecEvent {
  Number: number;
  Category: string;
  Description?: string;
  Details?: Record<string, unknown>;
}

export interface EventRecord {
  seq: number;
  at: number;
  publisher: string;
  source: string;
  filter: string | null;
  event: OecEvent;
}

export interface Limits {
  healthHistory: number;
  eventTrail: number;
  violationTrail: number;
}

export interface DirectoryFields {
  registry: string;
  version: string;
  limits: Limits;
  ignored: number;
}

export type StreamMessage =
  | (DirectoryFields & {
      type: "snapshot";
      time: number;
      assets: Summary[];
      events: EventRecord[];
    })
  | (DirectoryFields & { type: "directory" })
  | { type: "asset"; asset: Summary }
  | { type: "event"; event: EventRecord };

/** The path of the REST resource of one asset (the IL percent-encoded). */
export function assetPath(il: string): string {
  return "/api/assets/" + encodeURIComponent(il);
}

/** Sent on `window` when the registry answers 401: the session has ended. */
export const SESSION_ENDED = "oec-session-ended";

/** An answer of the registry that is not a success; `message` is its `error`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/**
 * One request to the API of the own origin. A 401 ends the session of the page
 * (except for the login itself, where it means wrong name or password).
 */
async function call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const resp = await fetch(path, {
    method,
    signal,
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resp.ok) {
    return resp;
  }
  let message = `${resp.status} ${resp.statusText}`;
  try {
    const e = (await resp.json()) as { error?: unknown };
    if (typeof e.error === "string") {
      message = e.error;
    }
  } catch {
    // No JSON error body: the status line is the message.
  }
  if (resp.status === 401 && path !== "/api/login") {
    window.dispatchEvent(new Event(SESSION_ENDED));
  }
  const retry = Number(resp.headers.get("Retry-After"));
  throw new ApiError(resp.status, message, Number.isFinite(retry) && retry > 0 ? retry : null);
}

/** Reads one asset; null if the registry does not know it (404). */
export async function fetchAsset(il: string, signal: AbortSignal): Promise<Asset | null> {
  try {
    return (await (await call("GET", assetPath(il), undefined, signal)).json()) as Asset;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return null;
    }
    throw e;
  }
}

/** The last value of one Data DataSet (`GET /api/data`, the data logger). */
export interface DataRecord {
  seq: number;
  at: number;
  publisher: string;
  source: string;
  filter: string | null;
  dataSetWriterId: number;
  /** null: longer than 16 KiB, not kept. */
  payload: Record<string, unknown> | null;
}

export interface DataSets {
  max: number;
  dataSets: DataRecord[];
}

/** Reads the last values of the data logger. */
export async function fetchData(signal: AbortSignal): Promise<DataSets> {
  return (await (await call("GET", "/api/data", undefined, signal)).json()) as DataSets;
}

export type Role = "admin" | "user";

/** A user of the registry (never its password). */
export interface User {
  name: string;
  role: Role;
  mustChange: boolean;
}

/** The passwords of the registry: 12 … 256 characters, not the name. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/** The user of the session of the page; null without a session. */
export async function fetchSession(): Promise<User | null> {
  try {
    return (await (await call("GET", "/api/session")).json()) as User;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return null;
    }
    throw e;
  }
}

/** Starts a session (the cookie); the user tells whether the password has to be changed. */
export async function login(name: string, password: string): Promise<User> {
  const u = (await (await call("POST", "/api/login", { name, password })).json()) as User & { token?: string };
  return { name: u.name, role: u.role, mustChange: u.mustChange };
}

export async function logout(): Promise<void> {
  await call("POST", "/api/logout");
}

/** Changes the own password; the other sessions of the user end. */
export async function changePassword(current: string, next: string): Promise<User> {
  return (await (await call("POST", "/api/password", { current, new: next })).json()) as User;
}

export async function fetchUsers(): Promise<User[]> {
  return ((await (await call("GET", "/api/users")).json()) as { users: User[] }).users;
}

/** A new user, who has to change the password at the first login. */
export async function createUser(name: string, role: Role, password: string): Promise<User> {
  return (await (await call("POST", "/api/users", { name, role, password })).json()) as User;
}

export async function updateUser(name: string, change: { role?: Role; password?: string }): Promise<User> {
  return (await (await call("PUT", "/api/users/" + encodeURIComponent(name), change)).json()) as User;
}

export async function deleteUser(name: string): Promise<void> {
  await call("DELETE", "/api/users/" + encodeURIComponent(name));
}
