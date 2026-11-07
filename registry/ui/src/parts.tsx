import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Availability, Conformity, Health, Observed, Summary } from "./api";
import {
  availabilityLabel,
  availabilityTone,
  healthLabel,
  healthTone,
  ilParts,
  type Label,
} from "./format";
import { Atom } from "./logo";

/** The labels of all assets (name and suffix), computed once per directory change. */
export const LabelsContext = createContext<ReadonlyMap<string, Label>>(new Map());

export function useLabel(il: string): Label {
  const l = useContext(LabelsContext).get(il);
  if (l !== undefined) {
    return l;
  }
  const model = ilParts(il)?.model ?? "";
  return { name: model !== "" ? model : il, suffix: null, fromIl: true };
}

export function assetHref(il: string): string {
  return "#/asset/" + encodeURIComponent(il);
}

/** The name of an asset with the suffix that tells it apart from assets with the same name. */
export function AssetName({ il }: { il: string }) {
  const l = useLabel(il);
  return (
    <>
      <span className={l.fromIl ? "name from-il" : "name"}>{l.name}</span>
      {l.suffix !== null && <span className="suffix">{l.suffix}</span>}
    </>
  );
}

/** A link to an asset: its name if the registry knows it, else its IL. */
export function AssetLink({ il, assets }: { il: string; assets: ReadonlyMap<string, Summary> }) {
  return (
    <a href={assetHref(il)} title={il} className="asset-link">
      {assets.has(il) ? <AssetName il={il} /> : <span className="mono">{il}</span>}
    </a>
  );
}

export function Badge({ tone, title, children }: { tone: string; title?: string; children: ReactNode }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function HealthBadge({ health }: { health: Health | null | undefined }) {
  if (!health) {
    return (
      <Badge tone="none" title="No Health received yet">
        <i className="dot" aria-hidden="true" />
        Unknown
      </Badge>
    );
  }
  return (
    <Badge tone={healthTone(health.Health)} title={`Health ${health.Health}`}>
      <i className="dot" aria-hidden="true" />
      {healthLabel(health.Health)}
      {health.HealthScore !== undefined && <span className="score">{health.HealthScore}</span>}
    </Badge>
  );
}

export function AvailabilityBadge({ a }: { a: Availability }) {
  return (
    <Badge tone={availabilityTone(a)} title={`Availability: ${a}`}>
      <i className="dot" aria-hidden="true" />
      {availabilityLabel(a)}
    </Badge>
  );
}

/** A dot for the availability, for dense lists. */
export function AvailabilityDot({ a }: { a: Availability }) {
  return (
    <i
      className={`status-dot tone-${availabilityTone(a)}${a === "online" ? " pulse" : ""}`}
      title={availabilityLabel(a)}
      aria-label={availabilityLabel(a)}
      role="img"
    />
  );
}

/** The observed Messaging level (informative, ADR-0029 §5). */
export function LevelBadge({ observed }: { observed: Observed | null }) {
  if (!observed) {
    return <span className="muted">–</span>;
  }
  const missing = observed.missing.length > 0 ? `; the next level misses ${observed.missing.join(", ")}` : "";
  return (
    <span className="badge tone-level" title={`Observed Messaging level ${observed.level} (informative)${missing}`}>
      L{observed.level}
    </span>
  );
}

export function ConformityBadge({ c }: { c: Conformity | null }) {
  if (!c) {
    return <span className="muted">–</span>;
  }
  return (
    <Badge
      tone={c.violations > 0 ? "bad" : "ok"}
      title={`${c.violations} of ${c.messages} messages violate their schema (informative)`}
    >
      {c.violations > 0 ? `${c.violations} violation${c.violations === 1 ? "" : "s"}` : "Schema ok"}
    </Badge>
  );
}

/** The kind of an asset: its ServiceType for an application, else "Device". */
export function KindBadge({ s }: { s: Summary }) {
  return (
    <span className={`kind kind-${s.kind}`} title={s.kind === "application" ? "Application (ServiceType)" : "Device"}>
      {s.kind === "application" ? s.serviceType : "Device"}
    </span>
  );
}

/** Copies `value` to the clipboard (the page is served over HTTPS, a secure context). */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) {
      return;
    }
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  if (navigator.clipboard === undefined) {
    return null;
  }
  return (
    <button
      type="button"
      className="icon-button"
      title={done ? "Copied" : `${label} to the clipboard`}
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setDone(true),
          () => undefined,
        );
      }}
    >
      {done ? <Icon name="check" /> : <Icon name="copy" />}
    </button>
  );
}

const ICONS: Record<string, string> = {
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20",
  chevron: "M9 6l6 6-6 6",
  sun: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  moon: "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z",
  auto: "M12 4a8 8 0 1 0 0 16zM12 4a8 8 0 0 1 0 16",
  pause: "M8 5v14M16 5v14",
  play: "M7 5l12 7-12 7z",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** An empty state with a short explanation. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Atom className="empty-mark" />
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}
