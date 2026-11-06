// The read-only HTTP API of the OEC Registry (api/openapi.json, ADR-0029 §9).
// Everything comes from the origin of the page: /api/assets/{il} and the
// event stream /api/stream; nothing is loaded from anywhere else.

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

/** Reads one asset; null if the registry does not know it (404). */
export async function fetchAsset(il: string, signal: AbortSignal): Promise<Asset | null> {
  const resp = await fetch(assetPath(il), {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`);
  }
  return (await resp.json()) as Asset;
}
