import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetDetail, type Tab } from "./AssetDetail";
import { AssetList, type ListState, type Show } from "./AssetList";
import { Dashboard } from "./Dashboard";
import { DataView, useData } from "./DataView";
import { EventsView } from "./EventList";
import { ago, labels, needsAttention, severity } from "./format";
import { useLive, type Connection } from "./live";
import { Atom, CommunityBadge } from "./logo";
import { assetHref, Icon, LabelsContext } from "./parts";

type Route = { view: "assets"; il: string | null; tab: Tab } | { view: "events" } | { view: "data" };

const TABS: readonly Tab[] = ["overview", "nameplate", "interfaces", "data", "conformity", "events"];

/**
 * The route from the location hash: `#/asset/<IL percent-encoded>[/<tab>]`,
 * `#/events`, `#/data` or the directory.
 */
function route(): Route {
  const h = window.location.hash;
  if (h === "#/events") {
    return { view: "events" };
  }
  if (h === "#/data") {
    return { view: "data" };
  }
  const m = /^#\/asset\/([^/]+)(?:\/([a-z]+))?$/.exec(h);
  if (m?.[1] === undefined) {
    return { view: "assets", il: null, tab: "overview" };
  }
  const tab = TABS.find((t) => t === m[2]) ?? "overview";
  try {
    return { view: "assets", il: decodeURIComponent(m[1]), tab };
  } catch {
    return { view: "assets", il: null, tab: "overview" };
  }
}

function useRoute(): Route {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => setR(route());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

/** Renders again every few seconds so that relative times stay current. */
function useTick(ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

type Theme = "system" | "light" | "dark";
const THEME_KEY = "oec-registry-theme";

function storedTheme(): Theme {
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** The colour theme: the system's or one chosen by the user (a `data-theme` attribute, no inline style). */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      delete root.dataset["theme"];
    } else {
      root.dataset["theme"] = theme;
    }
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  }, [theme]);
  const next = useCallback(() => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system")), []);
  return [theme, next];
}

const CONNECTION: Record<Connection, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

const THEME_LABEL: Record<Theme, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

function Kpi({
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`kpi${tone ? ` kpi-${tone}` : ""}${active ? " on" : ""}`} onClick={onClick} aria-pressed={active}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
    </button>
  );
}

export function App() {
  const live = useLive();
  const r = useRoute();
  const [theme, nextTheme] = useTheme();
  const [list, setList] = useState<ListState>({ query: "", show: "all", sort: "name" });
  useTick(5000);

  const names = useMemo(() => labels(live.assets), [live.assets]);
  const labelOf = useCallback(
    (il: string) => names.get(il) ?? { name: il, suffix: null },
    [names],
  );

  const counts = useMemo(() => {
    let apps = 0;
    let appsOnline = 0;
    let devices = 0;
    let devicesOnline = 0;
    let attention = 0;
    for (const a of live.assets.values()) {
      const on = a.availability === "online";
      if (a.kind === "application") {
        apps++;
        appsOnline += on ? 1 : 0;
      } else {
        devices++;
        devicesOnline += on ? 1 : 0;
      }
      attention += needsAttention(a) ? 1 : 0;
    }
    const warnings = live.events.filter((e) => {
      const s = severity(e.event);
      return s !== null && s <= 4;
    }).length;
    return { apps, appsOnline, devices, devicesOnline, attention, warnings };
  }, [live.assets, live.events]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el !== null && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        if (r.view !== "assets") {
          window.location.hash = "#/";
        }
        window.setTimeout(() => document.getElementById("asset-search")?.focus(), 0);
      } else if (e.key === "Escape" && r.view === "assets" && r.il !== null && !typing) {
        window.location.hash = "#/";
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [r]);

  useEffect(() => {
    const base = "OEC Registry";
    document.title =
      r.view === "events"
        ? `Events · ${base}`
        : r.view === "data"
          ? `Data · ${base}`
          : r.il !== null
          ? `${names.get(r.il)?.name ?? r.il} · ${base}`
          : base;
  }, [r, names]);

  const show = (s: Show) => {
    setList({ ...list, show: list.show === s && s !== "all" ? "all" : s });
    if (r.view !== "assets") {
      window.location.hash = "#/";
    }
  };
  const selected = r.view === "assets" ? r.il : null;
  const data = useData(r.view === "data" || (r.view === "assets" && r.il !== null && r.tab === "data"));
  const openTab = useCallback(
    (t: Tab) => {
      if (selected !== null) {
        window.location.replace(assetHref(selected) + (t === "overview" ? "" : `/${t}`));
      }
    },
    [selected],
  );
  const lastEvent = live.events[live.events.length - 1];

  return (
    <LabelsContext.Provider value={names}>
      <div className="page">
        <header className="appbar">
          <a className="brand" href="#/" aria-label="OEC Registry – overview">
            <Atom />
            <span className="brand-text">
              <span className="brand-kicker">OI4 Open Edge Computing</span>
              <span className="brand-name">
                OEC <b>Registry</b>
                <span className="brand-tag" title="A community project – not an official product of the Open Industry 4.0 Alliance">
                  Community
                </span>
              </span>
            </span>
          </a>
          <nav className="nav" aria-label="Views">
            <a href="#/" className={r.view === "assets" ? "on" : ""} aria-current={r.view === "assets" ? "page" : undefined}>
              Assets <span className="count">{live.assets.size}</span>
            </a>
            <a href="#/events" className={r.view === "events" ? "on" : ""} aria-current={r.view === "events" ? "page" : undefined}>
              Events <span className="count">{live.events.length}</span>
            </a>
            <a href="#/data" className={r.view === "data" ? "on" : ""} aria-current={r.view === "data" ? "page" : undefined}>
              Data <span className="count">{data.data?.dataSets.length ?? "–"}</span>
            </a>
          </nav>
          <div className="appbar-end">
            <span className={`conn conn-${live.connection}`} role="status" title="Connection to the event stream of the registry">
              <i className="dot" aria-hidden="true" />
              {CONNECTION[live.connection]}
            </span>
            <button type="button" className="icon-button on-dark" onClick={nextTheme} title={`${THEME_LABEL[theme]} – click to change`} aria-label={THEME_LABEL[theme]}>
              <Icon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "auto"} />
            </button>
          </div>
        </header>

        <div className="kpis">
          <Kpi
            label="Applications"
            value={counts.apps}
            sub={`${counts.appsOnline} online`}
            active={list.show === "applications" && r.view === "assets"}
            onClick={() => show("applications")}
          />
          <Kpi
            label="Devices"
            value={counts.devices}
            sub={`${counts.devicesOnline} online`}
            active={list.show === "devices" && r.view === "assets"}
            onClick={() => show("devices")}
          />
          <Kpi
            label="Attention"
            value={counts.attention}
            sub={counts.attention === 0 ? "all healthy" : "offline, Health or schema"}
            tone={counts.attention > 0 ? "warn" : "ok"}
            active={list.show === "attention" && r.view === "assets"}
            onClick={() => show("attention")}
          />
          <Kpi
            label="Events"
            value={live.events.length}
            sub={lastEvent ? `last ${ago(lastEvent.at, live.skew)}` : "none yet"}
            tone={counts.warnings > 0 ? "info" : undefined}
            active={r.view === "events"}
            onClick={() => {
              window.location.hash = "#/events";
            }}
          />
        </div>

        {r.view === "events" ? (
          <main className="main single">
            <EventsView live={live} />
          </main>
        ) : r.view === "data" ? (
          <main className="main single">
            <DataView live={live} data={data.data} error={data.error} />
          </main>
        ) : (
          <main className={`main${selected !== null ? " has-selection" : ""}`}>
            <AssetList live={live} selected={selected} state={list} onState={setList} labelOf={labelOf} />
            <aside className="card detail" aria-label={selected !== null ? "Asset" : "Overview"}>
              {selected === null ? (
                <Dashboard live={live} />
              ) : (
                <AssetDetail
                  key={selected}
                  il={selected}
                  summary={live.assets.get(selected)}
                  live={live}
                  data={data.data}
                  tab={r.view === "assets" ? r.tab : "overview"}
                  onTab={openTab}
                />
              )}
            </aside>
          </main>
        )}

        <footer className="foot">
          <div className="foot-about">
            <CommunityBadge className="foot-badge" />
            <span className="foot-text">
              <span>
                <b>OEC Registry</b>
                {live.directory && ` ${live.directory.version}`} · read-only · part of OI4 Open Edge Computing
              </span>
              <span>
                A community project – not an official product of the Open Industry 4.0 Alliance. The OI4 logo is a
                trademark of the Open Industry 4.0 Alliance.
              </span>
            </span>
          </div>
          <span className="foot-links">
            API <a href="/api/assets">/api/assets</a>
            <a href="/api/events">/api/events</a>
            <a href="/api/data">/api/data</a>
            <a href="/api/openapi.json">OpenAPI</a>
            <a href="/api/asyncapi.json">AsyncAPI</a>
          </span>
        </footer>
      </div>
    </LabelsContext.Provider>
  );
}
