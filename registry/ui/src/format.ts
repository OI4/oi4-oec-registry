import type { Availability, HealthState, LocalizedText, OecEvent, Summary } from "./api";

export function text(t: LocalizedText | undefined): string {
  return t?.Text ?? "";
}

/** Decodes the dnp-encoding of MG A3 (`,20` → space); the input if it is not valid. */
export function dnpDecode(s: string): string {
  if (!s.includes(",")) {
    return s;
  }
  try {
    return decodeURIComponent(s.replace(/%/g, "%25").replace(/,([0-9A-Fa-f]{2})/g, "%$1"));
  } catch {
    return s;
  }
}

/** The elements of an `Oi4Identifier` (MG 4.3.1): ManufacturerUri/Model/ProductCode/SerialNumber, decoded. */
export function ilParts(il: string): { manufacturerUri: string; model: string; productCode: string; serial: string } | null {
  const p = il.split("/");
  if (p.length < 4) {
    return null;
  }
  const [model, productCode, serial] = p.slice(-3).map(dnpDecode);
  return {
    manufacturerUri: p.slice(0, -3).join("/"),
    model: model ?? "",
    productCode: productCode ?? "",
    serial: serial ?? "",
  };
}

/** The display name of an asset: the Model of its MAM, else the Model of its IL, else its IL. */
export function nameOf(s: Summary): string {
  const model = text(s.mam?.Model);
  if (model !== "") {
    return model;
  }
  const parts = ilParts(s.il);
  return parts !== null && parts.model !== "" ? parts.model : s.il;
}

function serialOf(s: Summary): string {
  const serial = s.mam?.SerialNumber ?? "";
  return serial !== "" ? serial : (ilParts(s.il)?.serial ?? s.il);
}

export interface Label {
  name: string;
  /** Tells assets with the same name apart (from their SerialNumber); null if the name is unique. */
  suffix: string | null;
  /** The name comes from the IL, not from a MAM. */
  fromIl: boolean;
}

const SEPARATOR = /[-_.:/ ]/;

/** The part of `serial` from the token in which it starts to differ from `others`. */
function distinct(serial: string, others: string[]): string {
  let p = 0;
  for (const o of others) {
    let i = 0;
    while (i < serial.length && i < o.length && serial[i] === o[i]) {
      i++;
    }
    p = Math.max(p, i);
  }
  if (p >= serial.length) {
    return serial.length > 12 ? "…" + serial.slice(-12) : serial;
  }
  let cut = 0;
  for (let i = p - 2; i >= 0; i--) {
    if (SEPARATOR.test(serial[i] ?? "")) {
      cut = i + 1;
      break;
    }
  }
  return serial.slice(cut);
}

/** The labels of all assets, with suffixes for assets that share a name. */
export function labels(assets: ReadonlyMap<string, Summary>): Map<string, Label> {
  const byName = new Map<string, Summary[]>();
  for (const s of assets.values()) {
    const n = nameOf(s);
    byName.set(n, [...(byName.get(n) ?? []), s]);
  }
  const out = new Map<string, Label>();
  for (const [name, list] of byName) {
    for (const s of list) {
      const fromIl = text(s.mam?.Model) === "";
      if (list.length === 1) {
        out.set(s.il, { name, suffix: null, fromIl });
      } else {
        const serial = serialOf(s);
        const others = list.filter((o) => o !== s).map(serialOf);
        out.set(s.il, { name, suffix: distinct(serial, others), fromIl });
      }
    }
  }
  return out;
}

const HEALTH: Record<HealthState, { label: string; tone: string; rank: number }> = {
  NORMAL_0: { label: "Normal", tone: "ok", rank: 0 },
  MAINTENANCE_REQUIRED_4: { label: "Maintenance required", tone: "info", rank: 1 },
  OFF_SPEC_3: { label: "Off spec", tone: "warn", rank: 2 },
  CHECK_FUNCTION_2: { label: "Check function", tone: "warn", rank: 3 },
  FAILURE_1: { label: "Failure", tone: "bad", rank: 4 },
};

export const HEALTH_STATES: HealthState[] = [
  "NORMAL_0",
  "MAINTENANCE_REQUIRED_4",
  "OFF_SPEC_3",
  "CHECK_FUNCTION_2",
  "FAILURE_1",
];

export function healthLabel(h: HealthState): string {
  return HEALTH[h]?.label ?? h;
}

export function healthTone(h: HealthState | undefined): string {
  return h === undefined ? "none" : (HEALTH[h]?.tone ?? "none");
}

/** 0 = normal … 4 = failure; −1 = no Health known. */
export function healthRank(h: HealthState | undefined): number {
  return h === undefined ? -1 : (HEALTH[h]?.rank ?? -1);
}

const AVAILABILITY: Record<Availability, string> = {
  online: "Online",
  offlineGraceful: "Offline",
  offlineUngraceful: "Connection lost",
};

export function availabilityLabel(a: Availability): string {
  return AVAILABILITY[a] ?? a;
}

export function availabilityTone(a: Availability): string {
  return a === "online" ? "ok" : a === "offlineGraceful" ? "none" : "bad";
}

/** An asset that needs attention: not online, Health other than normal or schema violations. */
export function needsAttention(s: Summary): boolean {
  return (
    s.availability !== "online" ||
    (s.health !== null && s.health.Health !== "NORMAL_0") ||
    (s.conformity !== null && s.conformity.violations > 0)
  );
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A Unix time (ms) as local date and time. */
export function time(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "–";
  }
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** A Unix time (ms) as local time of day. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The time since `ms` (registry time), with `skew` = registry − local. */
export function ago(ms: number | null | undefined, skew: number): string {
  if (ms === null || ms === undefined) {
    return "–";
  }
  const s = Math.max(0, Math.round((Date.now() + skew - ms) / 1000));
  if (s < 5) {
    return "just now";
  }
  if (s < 60) {
    return `${s} s ago`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min ago`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)} h ago`;
  }
  return `${Math.floor(s / 86400)} d ago`;
}

/** A duration in ms, short (`3 h 12 min`). */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s} s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h} h ${m % 60} min`;
  }
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** An enumeration value of the guideline without its number (`ON_REQUEST_1` → `ON_REQUEST`). */
export function enumName(v: string | undefined): string {
  return v === undefined ? "–" : v.replace(/_\d+$/, "");
}

/** A readable enumeration value (`ON_REQUEST_SOURCE_10` → `On request source`). */
export function enumText(v: string | undefined): string {
  if (v === undefined) {
    return "–";
  }
  const s = enumName(v).replace(/^CAT_/, "").toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SYSLOG = ["Emergency", "Alert", "Critical", "Error", "Warning", "Notice", "Informational", "Debug"];

/** The severity of an Event: 0 (worst) … 7, or null if it has none. */
export function severity(e: OecEvent): number | null {
  if (e.Category === "CAT_SYSLOG_0") {
    return e.Number % 8;
  }
  const c = statusClass(e);
  return c === null ? null : c === "Bad" ? 3 : c === "Uncertain" ? 4 : 6;
}

/**
 * The severity class of a Status Event: the two most significant bits of the
 * StatusCode in `Number` (MG 8.3.6.1; the reserved value 3 counts as Bad).
 */
function statusClass(e: OecEvent): "Good" | "Uncertain" | "Bad" | null {
  if (e.Category !== "CAT_STATUS_1" || !Number.isInteger(e.Number) || e.Number < 0) {
    return null;
  }
  const bits = Math.floor(e.Number / 0x40000000) % 4;
  return bits === 0 ? "Good" : bits === 1 ? "Uncertain" : "Bad";
}

/** `Number` of an Event; a StatusCode in hexadecimal (e.g. 0x80060000). */
export function eventNumber(e: OecEvent): string {
  return e.Category === "CAT_STATUS_1" && Number.isInteger(e.Number) && e.Number >= 0
    ? "0x" + e.Number.toString(16).toUpperCase().padStart(8, "0")
    : String(e.Number);
}

export function severityLabel(e: OecEvent): string {
  const s = severity(e);
  if (e.Category === "CAT_SYSLOG_0" && s !== null) {
    return SYSLOG[s] ?? String(s);
  }
  return statusClass(e) ?? enumText(e.Category);
}

export function eventTone(e: OecEvent): string {
  const s = severity(e);
  return s === null ? "none" : s <= 3 ? "bad" : s === 4 ? "warn" : s === 5 ? "info" : "none";
}

/** The text of an Event: Description, the Syslog MSG or the SymbolicId of a Status Event. */
export function eventMessage(e: OecEvent): string {
  const parts: string[] = [];
  if (e.Description !== undefined && e.Description !== "") {
    parts.push(e.Description);
  }
  const d = e.Details ?? {};
  for (const key of ["MSG", "SymbolicId"]) {
    const v = d[key];
    if (typeof v === "string" && v !== "") {
      parts.push(v);
    }
  }
  const rest = Object.keys(d).filter((k) => k !== "MSG" && k !== "SymbolicId" && k !== "HEADER");
  if (rest.length > 0) {
    parts.push(JSON.stringify(Object.fromEntries(rest.map((k) => [k, d[k]]))));
  }
  return parts.join(" · ");
}

function base64url(s: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    return null;
  }
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export interface Topic {
  serviceType: string;
  /** The decoded IL of the AppId, or the raw level (e.g. a wildcard). */
  appId: string;
  method: string;
  resource: string | null;
  source: string | null;
  filter: string | null;
}

/** A topic of MG 7 with its AppId and Source decoded (base64url); null if it is not one. */
export function parseTopic(t: string): Topic | null {
  const p = t.split("/");
  if (p[0] !== "Oi4v2" || p.length < 4) {
    return null;
  }
  const dec = (s: string | undefined) => (s === undefined ? null : (base64url(s) ?? s));
  return {
    serviceType: p[1] ?? "",
    appId: dec(p[2]) ?? "",
    method: p[3] ?? "",
    resource: p[4] ?? null,
    source: dec(p[5]),
    filter: p.length > 6 ? p.slice(6).join("/") : null,
  };
}
