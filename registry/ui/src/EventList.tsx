import { useMemo, useState } from "react";
import type { EventRecord, Summary } from "./api";
import { ago, clock, enumText, eventMessage, eventNumber, eventTone, severity, severityLabel, time } from "./format";
import type { Live } from "./live";
import { AssetLink, Badge, Empty, Icon } from "./parts";

export function EventTable({
  events,
  assets,
  showSource,
  skew,
  limit,
}: {
  events: readonly EventRecord[];
  assets: ReadonlyMap<string, Summary>;
  showSource: boolean;
  skew: number;
  limit?: number;
}) {
  const rows = useMemo(() => {
    const r = [...events].reverse();
    return limit === undefined ? r : r.slice(0, limit);
  }, [events, limit]);
  if (events.length === 0) {
    return <p className="muted pad">No Event received.</p>;
  }
  return (
    <div className="scroll">
      <table className="grid events-table">
        <thead>
          <tr>
            <th>Received</th>
            {showSource && <th>Source</th>}
            <th>Severity</th>
            <th>Message</th>
            <th className="num">#</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq} className={`sev-${eventTone(r.event)}`}>
              <td className="nowrap" title={time(r.at)}>
                <span className="mono">{clock(r.at)}</span>
                <div className="small muted">{ago(r.at, skew)}</div>
              </td>
              {showSource && (
                <td>
                  <AssetLink il={r.source} assets={assets} />
                  {r.source !== r.publisher && (
                    <div className="small muted">
                      via <AssetLink il={r.publisher} assets={assets} />
                    </div>
                  )}
                </td>
              )}
              <td className="nowrap">
                <Badge tone={eventTone(r.event)} title={`${r.event.Category}, Number ${r.event.Number}`}>
                  {severityLabel(r.event)}
                </Badge>
                <div className="small muted">
                  {enumText(r.event.Category)} {eventNumber(r.event)}
                </div>
              </td>
              <td className="wrap">
                {eventMessage(r.event) || <span className="muted">–</span>}
                {r.filter !== null && <div className="small muted mono">Filter {r.filter}</div>}
              </td>
              <td className="num muted small">{r.seq}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Level = "all" | "warnings" | "errors";

export function EventsView({ live }: { live: Live }) {
  const [paused, setPaused] = useState<readonly EventRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Level>("all");
  const [category, setCategory] = useState("");
  const source = paused ?? live.events;
  const categories = useMemo(() => [...new Set(live.events.map((e) => e.event.Category))].sort(), [live.events]);
  const q = query.trim().toLowerCase();
  const events = useMemo(
    () =>
      source.filter((r) => {
        const s = severity(r.event);
        if (level === "errors" && (s === null || s > 3)) {
          return false;
        }
        if (level === "warnings" && (s === null || s > 4)) {
          return false;
        }
        if (category !== "" && r.event.Category !== category) {
          return false;
        }
        if (q === "") {
          return true;
        }
        const name = live.assets.get(r.source)?.mam?.Model.Text ?? "";
        return `${eventMessage(r.event)} ${r.source} ${name} ${r.filter ?? ""}`.toLowerCase().includes(q);
      }),
    [source, level, category, q, live.assets],
  );
  const lastSeq = paused?.[paused.length - 1]?.seq ?? -1;
  const newer = paused ? live.events.filter((e) => e.seq > lastSeq).length : 0;
  return (
    <section className="card events-card" aria-label="Event trail">
      <div className="card-head">
        <div>
          <h2>Event trail</h2>
          <p className="muted small">
            Events of all participants, latest first · {live.events.length}
            {live.directory ? ` of at most ${live.directory.limits.eventTrail}` : ""} kept
          </p>
        </div>
        <button type="button" className={`button${paused ? " primary" : ""}`} onClick={() => setPaused(paused ? null : live.events)}>
          <Icon name={paused ? "play" : "pause"} />
          {paused ? `Resume${newer > 0 ? ` (${newer} new)` : ""}` : "Pause"}
        </button>
      </div>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search message, source, filter …"
            aria-label="Search events"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented" role="group" aria-label="Severity">
          {(
            [
              ["all", "All"],
              ["warnings", "Warnings & errors"],
              ["errors", "Errors"],
            ] as [Level, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" className={level === v ? "on" : ""} aria-pressed={level === v} onClick={() => setLevel(v)}>
              {l}
            </button>
          ))}
        </div>
        <label className="sort">
          <span className="muted small">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {enumText(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {live.events.length === 0 ? (
        <Empty title="No Event received yet">
          The registry keeps the latest Events of every participant on the bus (Syslog, Status, NE 107 and generic
          Events).
        </Empty>
      ) : events.length === 0 ? (
        <Empty title="Nothing matches">No Event matches the search or the filter.</Empty>
      ) : (
        <EventTable events={events} assets={live.assets} showSource={true} skew={live.skew} />
      )}
    </section>
  );
}
