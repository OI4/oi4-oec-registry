import type { Availability, HealthState, LocalizedText, Summary } from "./api";

export function text(t: LocalizedText | undefined): string {
  return t?.Text ?? "";
}

/** The display name of an asset: the Model of its MAM, else its IL. */
export function nameOf(s: Summary): string {
  const model = text(s.mam?.Model);
  return model !== "" ? model : s.il;
}

const HEALTH: Record<HealthState, { label: string; tone: string }> = {
  NORMAL_0: { label: "Normal", tone: "ok" },
  FAILURE_1: { label: "Failure", tone: "bad" },
  CHECK_FUNCTION_2: { label: "Check function", tone: "warn" },
  OFF_SPEC_3: { label: "Off spec", tone: "warn" },
  MAINTENANCE_REQUIRED_4: { label: "Maintenance required", tone: "info" },
};

export function healthLabel(h: HealthState): string {
  return HEALTH[h]?.label ?? h;
}

export function healthTone(h: HealthState | undefined): string {
  return h === undefined ? "none" : (HEALTH[h]?.tone ?? "none");
}

const AVAILABILITY: Record<Availability, string> = {
  online: "Online",
  offlineGraceful: "Offline",
  offlineUngraceful: "Offline (lost)",
};

export function availabilityLabel(a: Availability): string {
  return AVAILABILITY[a] ?? a;
}

export function availabilityTone(a: Availability): string {
  return a === "online" ? "ok" : a === "offlineGraceful" ? "none" : "bad";
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

/** The time since `ms` (registry time), with `skew` = registry − local. */
export function ago(ms: number | null | undefined, skew: number): string {
  if (ms === null || ms === undefined) {
    return "–";
  }
  const s = Math.max(0, Math.round((Date.now() + skew - ms) / 1000));
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

/** An enumeration value of the guideline without its number (`ON_REQUEST_1` → `ON_REQUEST`). */
export function enumName(v: string | undefined): string {
  return v === undefined ? "–" : v.replace(/_\d+$/, "");
}
