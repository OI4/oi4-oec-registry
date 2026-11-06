import { useState } from "react";
import type { EventRecord, OecEvent, Summary } from "./api";
import { enumName, time } from "./format";
import type { Live } from "./live";
import { AssetLink } from "./parts";

/** The text of an Event: Description, the Syslog MSG or the SymbolicId of a Status Event. */
function message(e: OecEvent): string {
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

function tone(e: OecEvent): string {
  if (e.Category === "CAT_SYSLOG_0") {
    const severity = e.Number % 8;
    return severity <= 3 ? "bad" : severity === 4 ? "warn" : "none";
  }
  return "none";
}

export function EventTable({
  events,
  assets,
  showSource,
}: {
  events: readonly EventRecord[];
  assets: ReadonlyMap<string, Summary>;
  showSource: boolean;
}) {
  if (events.length === 0) {
    return <p className="muted">No Event received.</p>;
  }
  return (
    <div className="scroll">
      <table className="grid small">
        <thead>
          <tr>
            <th>#</th>
            <th>Received</th>
            {showSource && <th>Source</th>}
            <th>Category</th>
            <th>Number</th>
            <th>Filter</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {[...events].reverse().map((r) => (
            <tr key={r.seq}>
              <td className="muted">{r.seq}</td>
              <td className="nowrap">{time(r.at)}</td>
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
              <td>
                <span className={`badge tone-${tone(r.event)}`}>{enumName(r.event.Category)}</span>
              </td>
              <td>{r.event.Number}</td>
              <td className="mono">{r.filter ?? "–"}</td>
              <td className="wrap">{message(r.event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EventList({ live }: { live: Live }) {
  const [paused, setPaused] = useState<readonly EventRecord[] | null>(null);
  const events = paused ?? live.events;
  return (
    <>
      <div className="bar">
        <h2>Events</h2>
        <span className="muted small">
          {live.events.length}
          {live.directory ? ` of at most ${live.directory.limits.eventTrail}` : ""} kept, latest first
        </span>
        <button type="button" onClick={() => setPaused(paused ? null : live.events)}>
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <EventTable events={events} assets={live.assets} showSource={true} />
    </>
  );
}
