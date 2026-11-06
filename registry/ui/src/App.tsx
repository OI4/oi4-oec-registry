import { useEffect, useMemo, useState } from "react";
import { AssetDetail } from "./AssetDetail";
import { AssetTable } from "./AssetTable";
import { EventList } from "./EventList";
import { useLive, type Connection } from "./live";

/** The selected asset from the location hash `#/asset/<IL percent-encoded>`. */
function selected(): string | null {
  const m = /^#\/asset\/(.+)$/.exec(window.location.hash);
  if (m?.[1] === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function useSelected(): string | null {
  const [il, setIl] = useState(selected);
  useEffect(() => {
    const on = () => setIl(selected());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return il;
}

/** Renders again every few seconds so that relative times stay current. */
function useTick(ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

const CONNECTION: Record<Connection, string> = {
  connecting: "Connecting …",
  live: "Live",
  reconnecting: "Reconnecting …",
};

export function App() {
  const live = useLive();
  const il = useSelected();
  useTick(5000);
  const counts = useMemo(() => {
    let apps = 0;
    let devices = 0;
    let online = 0;
    for (const a of live.assets.values()) {
      if (a.kind === "application") {
        apps++;
      } else {
        devices++;
      }
      if (a.availability === "online") {
        online++;
      }
    }
    return { apps, devices, online };
  }, [live.assets]);
  const summary = il === null ? undefined : live.assets.get(il);
  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <a href="#/">OEC Registry</a>
          {live.directory && (
            <span className="muted mono" title="AppId of the registry">
              {live.directory.registry}
            </span>
          )}
          {live.directory && <span className="muted">v{live.directory.version}</span>}
        </div>
        <div className="stats">
          <span>
            <b>{counts.apps}</b> applications
          </span>
          <span>
            <b>{counts.devices}</b> devices
          </span>
          <span>
            <b>{counts.online}</b> online
          </span>
          {live.directory && (
            <span title="Messages ignored since the start: not parseable or not of the expected form">
              <b>{live.directory.ignored}</b> ignored
            </span>
          )}
          <span className={`badge conn-${live.connection}`} role="status">
            {CONNECTION[live.connection]}
          </span>
        </div>
      </header>
      <main className="main">
        <section className="panel assets">
          <AssetTable live={live} selected={il} />
        </section>
        <section className="panel detail">
          {il === null ? (
            <div className="hint">
              <h2>Directory</h2>
              <p>
                The registry lists the applications and devices it observes on the OEC bus. Select an
                asset for its MAM, Health, availability, Profile, publications, observed Messaging level
                and schema conformity.
              </p>
              <p className="muted">
                The observed level and the conformity counters are informative; a conformity verdict is the
                result of the D7 test tool <span className="mono">oec-check</span>.
              </p>
            </div>
          ) : (
            <AssetDetail key={il} il={il} summary={summary} live={live} />
          )}
        </section>
        <section className="panel events">
          <EventList live={live} />
        </section>
      </main>
      <footer className="foot muted">
        Read-only. API: <a href="/api/assets">/api/assets</a> · <a href="/api/events">/api/events</a> ·{" "}
        <a href="/api/openapi.json">openapi.json</a> · <a href="/api/asyncapi.json">asyncapi.json</a>
      </footer>
    </div>
  );
}
