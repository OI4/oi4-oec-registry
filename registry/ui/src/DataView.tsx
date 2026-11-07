import { useEffect, useMemo, useState } from "react";
import { fetchData, type DataRecord, type DataSets } from "./api";
import { ago } from "./format";
import type { Live } from "./live";
import { AssetLink, AvailabilityDot, Empty, Icon } from "./parts";

/** A DataSet without update for longer than this is shown as stale. */
const STALE_MS = 60_000;
/** The fields shown per DataSet at most. */
const MAX_FIELDS = 40;

/**
 * The data logger of the registry, polled from `/api/data`: every `fastMs`
 * while a view shows it, else every 15 s (for the count); not while the
 * page is hidden.
 */
export function useData(fast: boolean): { data: DataSets | null; error: string | null } {
  const [data, setData] = useState<DataSets | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    let timer = 0;
    const poll = async () => {
      if (!document.hidden) {
        try {
          setData(await fetchData(ctl.signal));
          setError(null);
        } catch (e) {
          if (ctl.signal.aborted) {
            return;
          }
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      timer = window.setTimeout(() => void poll(), fast ? 2000 : 15000);
    };
    void poll();
    return () => {
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [fast]);
  return { data, error };
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** One value of a DataSet, short. */
function value(v: unknown): string {
  if (typeof v === "number") {
    return Number.isFinite(v) ? NUMBER.format(v) : String(v);
  }
  if (typeof v === "string") {
    return v;
  }
  if (v === null || typeof v === "boolean") {
    return String(v);
  }
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

/** The fields of a Payload, nested objects one level flattened (`a.b`). */
function fields(p: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(p)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        out.push([`${k}.${k2}`, v2]);
      }
    } else {
      out.push([k, v]);
    }
  }
  return out;
}

function DataCard({ r, live, showSource }: { r: DataRecord; live: Live; showSource: boolean }) {
  const src = live.assets.get(r.source);
  const stale = Date.now() + live.skew - r.at > STALE_MS;
  const all = r.payload === null ? [] : fields(r.payload);
  const shown = all.slice(0, MAX_FIELDS);
  return (
    <article className={`data-card${stale ? " stale" : ""}`}>
      <header className="data-head">
        <span className="data-name" title="Filter of the topic (the DataSet)">
          {r.filter ?? "–"}
        </span>
        <span className={`data-age${stale ? "" : " fresh"}`} title={new Date(r.at).toLocaleString()}>
          {ago(r.at, live.skew)}
        </span>
      </header>
      {showSource && (
        <p className="data-source small">
          {src && <AvailabilityDot a={src.availability} />}
          <AssetLink il={r.source} assets={live.assets} />
          {r.publisher !== r.source && (
            <span className="muted">
              {" "}
              via <AssetLink il={r.publisher} assets={live.assets} />
            </span>
          )}
        </p>
      )}
      {r.payload === null ? (
        <p className="muted small">The Payload is larger than 16 KiB and not kept.</p>
      ) : all.length === 0 ? (
        <p className="muted small">Empty Payload.</p>
      ) : (
        <dl className="data-fields">
          {shown.map(([k, v]) => {
            const text = value(v);
            return (
              <div key={k} className="data-field">
                <dt title={k}>{k}</dt>
                <dd key={text} className={typeof v === "number" ? "num" : undefined} title={text}>
                  {text}
                </dd>
              </div>
            );
          })}
          {all.length > shown.length && <p className="muted small">+ {all.length - shown.length} more fields</p>}
        </dl>
      )}
      <footer className="data-meta small muted">DataSetWriterId {r.dataSetWriterId}</footer>
    </article>
  );
}

/** The DataSets `records` as cards. */
export function DataCards({ records, live, showSource }: { records: DataRecord[]; live: Live; showSource: boolean }) {
  return (
    <div className="data-grid">
      {records.map((r) => (
        <DataCard key={`${r.publisher}|${r.source}|${r.filter ?? ""}`} r={r} live={live} showSource={showSource} />
      ))}
    </div>
  );
}

/** The page `#/data`: the last value of every Data DataSet on the bus. */
export function DataView({ live, data, error }: { live: Live; data: DataSets | null; error: string | null }) {
  const [query, setQuery] = useState("");
  const records = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data?.dataSets ?? [];
    if (q === "") {
      return all;
    }
    return all.filter((r) => {
      const name = live.assets.get(r.source)?.mam?.Model.Text ?? "";
      const keys = r.payload ? Object.keys(r.payload).join(" ") : "";
      return `${r.source} ${name} ${r.filter ?? ""} ${keys}`.toLowerCase().includes(q);
    });
  }, [data, query, live.assets]);
  const n = data?.dataSets.length ?? 0;
  return (
    <section className="card data-page" aria-label="Data logger">
      <div className="card-head">
        <div>
          <h2>Data logger</h2>
          <p className="muted small">
            The last value of every Data DataSet on the bus · {n} DataSet{n === 1 ? "" : "s"}
            {data ? ` of at most ${data.max}` : ""} · in memory only, no history
          </p>
        </div>
      </div>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search asset, DataSet, field …"
            aria-label="Search DataSets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="error">Could not read the data: {error}</p>}
      {data === null ? (
        error ? null : <p className="muted pad">Loading …</p>
      ) : n === 0 ? (
        <Empty title="No Data received yet">
          The registry shows the last value of every Data DataSet published on the bus (<span className="mono">Pub/Data</span>).
        </Empty>
      ) : records.length === 0 ? (
        <Empty title="Nothing matches">No DataSet matches the search.</Empty>
      ) : (
        <DataCards records={records} live={live} showSource={true} />
      )}
    </section>
  );
}
