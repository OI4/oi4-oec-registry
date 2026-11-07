import { useMemo, useState } from "react";
import type { Summary } from "./api";
import { ago, healthRank, ilParts, needsAttention, text } from "./format";
import type { Live } from "./live";
import {
  AssetName,
  AvailabilityDot,
  ConformityBadge,
  Empty,
  HealthBadge,
  Icon,
  KindBadge,
  LevelBadge,
  assetHref,
} from "./parts";

export type Show = "all" | "applications" | "devices" | "attention";
export type Sort = "name" | "health" | "seen";

export interface ListState {
  query: string;
  show: Show;
  sort: Sort;
}

function hay(s: Summary, name: string, suffix: string | null): string {
  return `${name} ${suffix ?? ""} ${s.il} ${s.serviceType} ${text(s.mam?.Manufacturer)} ${s.mam?.ProductCode ?? ""}`.toLowerCase();
}

interface Group {
  app: Summary | null;
  devices: Summary[];
  /** Devices hidden by the filter. */
  hidden: number;
}

function compare(sort: Sort, label: (il: string) => string) {
  return (a: Summary, b: Summary) => {
    if (sort === "health") {
      const d =
        Number(needsAttention(b)) - Number(needsAttention(a)) ||
        healthRank(b.health?.Health) - healthRank(a.health?.Health);
      if (d !== 0) {
        return d;
      }
    } else if (sort === "seen") {
      const d = b.lastSeen - a.lastSeen;
      if (d !== 0) {
        return d;
      }
    }
    return label(a.il).localeCompare(label(b.il)) || a.il.localeCompare(b.il);
  };
}

/** Applications with the devices they represent, filtered and sorted. */
function groups(
  assets: ReadonlyMap<string, Summary>,
  state: ListState,
  match: (s: Summary) => boolean,
  label: (il: string) => string,
): Group[] {
  const cmp = compare(state.sort, label);
  const kindOk = (s: Summary) =>
    state.show === "all" ||
    (state.show === "applications" && s.kind === "application") ||
    (state.show === "devices" && s.kind === "device") ||
    (state.show === "attention" && needsAttention(s));
  const ok = (s: Summary) => kindOk(s) && match(s);
  const out: Group[] = [];
  const placed = new Set<string>();
  for (const app of [...assets.values()].filter((s) => s.kind === "application").sort(cmp)) {
    const devices = app.devices
      .map((il) => assets.get(il))
      .filter((d): d is Summary => d !== undefined && d.kind === "device")
      .sort(cmp);
    devices.forEach((d) => placed.add(d.il));
    const shown = devices.filter(ok);
    if (state.show === "devices") {
      if (shown.length > 0) {
        out.push({ app, devices: shown, hidden: devices.length - shown.length });
      }
    } else if (ok(app) || shown.length > 0) {
      const all = ok(app) && state.show === "all" && state.query === "";
      out.push({ app, devices: all ? devices : shown, hidden: all ? 0 : devices.length - shown.length });
    }
  }
  const rest = [...assets.values()].filter((s) => s.kind === "device" && !placed.has(s.il) && ok(s)).sort(cmp);
  if (rest.length > 0) {
    out.push({ app: null, devices: rest, hidden: 0 });
  }
  return out;
}

function Row({
  s,
  live,
  selected,
  dim,
  twisty,
}: {
  s: Summary;
  live: Live;
  selected: boolean;
  dim: boolean;
  twisty?: { open: boolean; count: number; toggle: () => void };
}) {
  const manufacturer = text(s.mam?.Manufacturer) || ilParts(s.il)?.manufacturerUri || "";
  return (
    <div className={`row${selected ? " sel" : ""}${dim ? " dim" : ""}${s.kind === "device" ? " device" : ""}`}>
      {twisty ? (
        <button
          type="button"
          className={`twisty${twisty.open ? " open" : ""}`}
          onClick={twisty.toggle}
          aria-expanded={twisty.open}
          title={`${twisty.open ? "Hide" : "Show"} ${twisty.count} device${twisty.count === 1 ? "" : "s"}`}
        >
          <Icon name="chevron" />
        </button>
      ) : (
        <span className="twisty-space" />
      )}
      <a className="row-link" href={assetHref(s.il)} aria-current={selected ? "true" : undefined}>
        <AvailabilityDot a={s.availability} />
        <span className="row-main">
          <span className="row-title">
            <AssetName il={s.il} />
          </span>
          <span className="row-sub">
            <KindBadge s={s} />
            {manufacturer !== "" && <span className="row-maker">{manufacturer}</span>}
            {twisty && !twisty.open && twisty.count > 0 && (
              <span className="row-count">
                {twisty.count} device{twisty.count === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </span>
        <span className="row-badges">
          <HealthBadge health={s.health} />
          <LevelBadge observed={s.observed} />
          {s.conformity && s.conformity.violations > 0 && <ConformityBadge c={s.conformity} />}
        </span>
        <span className="row-time" title={`Last message ${new Date(s.lastSeen).toLocaleString()}`}>
          {ago(s.lastSeen, live.skew)}
        </span>
      </a>
    </div>
  );
}

export function AssetList({
  live,
  selected,
  state,
  onState,
  labelOf,
}: {
  live: Live;
  selected: string | null;
  state: ListState;
  onState: (s: ListState) => void;
  labelOf: (il: string) => { name: string; suffix: string | null };
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const q = state.query.trim().toLowerCase();
  const gs = useMemo(() => {
    const match = (s: Summary) => {
      if (q === "") {
        return true;
      }
      const l = labelOf(s.il);
      return hay(s, l.name, l.suffix).includes(q);
    };
    const name = (il: string) => {
      const l = labelOf(il);
      return `${l.name} ${l.suffix ?? ""}`;
    };
    return groups(live.assets, { ...state, query: q }, match, name);
  }, [live.assets, state, q, labelOf]);
  const attention = useMemo(() => [...live.assets.values()].filter(needsAttention).length, [live.assets]);
  const shownCount = gs.reduce((n, g) => n + (g.app ? 1 : 0) + g.devices.length, 0);
  const toggle = (il: string) => {
    const next = new Set(collapsed);
    if (next.has(il)) {
      next.delete(il);
    } else {
      next.add(il);
    }
    setCollapsed(next);
  };
  const filters: [Show, string, number | null][] = [
    ["all", "All", live.assets.size],
    ["applications", "Applications", null],
    ["devices", "Devices", null],
    ["attention", "Attention", attention],
  ];
  return (
    <section className="card list-card" aria-label="Applications and devices">
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            id="asset-search"
            type="search"
            placeholder="Search name, IL, ServiceType, manufacturer …"
            aria-label="Search assets"
            value={state.query}
            onChange={(e) => onState({ ...state, query: e.target.value })}
          />
          <kbd title="Press / to search">/</kbd>
        </label>
        <div className="segmented" role="group" aria-label="Show">
          {filters.map(([v, l, n]) => (
            <button
              key={v}
              type="button"
              className={`${state.show === v ? "on" : ""}${v === "attention" && attention > 0 ? " attn" : ""}`}
              aria-pressed={state.show === v}
              onClick={() => onState({ ...state, show: v })}
            >
              {l}
              {n !== null && <span className="count">{n}</span>}
            </button>
          ))}
        </div>
        <label className="sort">
          <span className="muted small">Sort</span>
          <select value={state.sort} onChange={(e) => onState({ ...state, sort: e.target.value as Sort })}>
            <option value="name">Name</option>
            <option value="health">Attention first</option>
            <option value="seen">Last seen</option>
          </select>
        </label>
      </div>
      {live.assets.size === 0 ? (
        <Empty title={live.directory ? "No asset seen yet" : "Waiting for the registry …"}>
          {live.directory
            ? "The registry lists every application and device as soon as it publishes on the OEC Message Bus."
            : "Connecting to the event stream of the registry."}
        </Empty>
      ) : gs.length === 0 ? (
        <Empty title="Nothing matches">
          No asset matches the search or the filter.{" "}
          <button type="button" className="link" onClick={() => onState({ ...state, query: "", show: "all" })}>
            Show all
          </button>
        </Empty>
      ) : (
        <>
          <div className="list-head">
            <span>
              {shownCount} of {live.assets.size} assets
            </span>
            <span className="list-cols">
              <span>Health · Level</span>
              <span>Last seen</span>
            </span>
          </div>
          <div className="rows" role="list">
            {gs.map((g) => {
              const open = g.app === null || !collapsed.has(g.app.il) || q !== "";
              return (
                <div className="group" role="listitem" key={g.app?.il ?? "-"}>
                  {g.app ? (
                    <Row
                      s={g.app}
                      live={live}
                      selected={g.app.il === selected}
                      dim={state.show === "devices"}
                      twisty={
                        g.devices.length > 0
                          ? { open, count: g.devices.length, toggle: () => toggle(g.app?.il ?? "") }
                          : undefined
                      }
                    />
                  ) : (
                    <div className="group-label">Devices without a known application</div>
                  )}
                  {open && g.devices.length > 0 && (
                    <div className={g.app ? "children" : undefined}>
                      {g.devices.map((d) => (
                        <Row key={d.il} s={d} live={live} selected={d.il === selected} dim={false} />
                      ))}
                      {g.hidden > 0 && (
                        <div className="hidden-note">
                          {g.hidden} more device{g.hidden === 1 ? "" : "s"} hidden by the filter
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
