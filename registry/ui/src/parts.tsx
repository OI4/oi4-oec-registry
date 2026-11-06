import type { Availability, Conformity, Health, Observed, Summary } from "./api";
import { availabilityLabel, availabilityTone, healthLabel, healthTone, nameOf } from "./format";

export function assetHref(il: string): string {
  return "#/asset/" + encodeURIComponent(il);
}

/** A link to an asset: its name if the registry knows it, else its IL. */
export function AssetLink({ il, assets }: { il: string; assets: ReadonlyMap<string, Summary> }) {
  const s = assets.get(il);
  return (
    <a href={assetHref(il)} title={il}>
      {s ? nameOf(s) : <span className="mono">{il}</span>}
    </a>
  );
}

export function HealthBadge({ health }: { health: Health | null | undefined }) {
  if (!health) {
    return <span className="badge tone-none">unknown</span>;
  }
  return (
    <span className={`badge tone-${healthTone(health.Health)}`} title={health.Health}>
      {healthLabel(health.Health)}
      {health.HealthScore !== undefined && <span className="score">{health.HealthScore}</span>}
    </span>
  );
}

export function AvailabilityBadge({ a }: { a: Availability }) {
  return <span className={`badge tone-${availabilityTone(a)}`}>{availabilityLabel(a)}</span>;
}

/** The observed Messaging level (informative, ADR-0029 §5). */
export function LevelBadge({ observed }: { observed: Observed | null }) {
  if (!observed) {
    return <span className="muted">–</span>;
  }
  const missing = observed.missing.length > 0 ? `; next level misses ${observed.missing.join(", ")}` : "";
  return (
    <span className="badge tone-level" title={`Observed Messaging level (informative)${missing}`}>
      L{observed.level}
    </span>
  );
}

export function ConformityBadge({ c }: { c: Conformity | null }) {
  if (!c) {
    return <span className="muted">–</span>;
  }
  return (
    <span
      className={`badge tone-${c.violations > 0 ? "bad" : "ok"}`}
      title={`${c.violations} of ${c.messages} messages violate their schema (informative)`}
    >
      {c.violations}/{c.messages}
    </span>
  );
}
