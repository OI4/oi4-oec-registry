import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchAsset, type Asset, type DataSets, type Mam, type PublicationEntry, type Summary } from "./api";
import { DataCards } from "./DataView";
import { EventTable } from "./EventList";
import { HealthChart } from "./HealthChart";
import {
  ago,
  availabilityLabel,
  duration,
  enumText,
  healthLabel,
  healthTone,
  parseTopic,
  text,
  time,
} from "./format";
import type { Live } from "./live";
import {
  AssetLink,
  AssetName,
  AvailabilityBadge,
  AvailabilityDot,
  Badge,
  ConformityBadge,
  CopyButton,
  Empty,
  HealthBadge,
  Icon,
  KindBadge,
  LevelBadge,
} from "./parts";

/** At most one read of the asset per this time while its summary changes. */
const REFRESH_MS = 1000;

type Reader = { ctl: AbortController; busy: boolean; dirty: boolean; timer: number | null; last: number };

/**
 * Reads `/api/assets/{il}` and again whenever the live summary of the asset
 * changes: at most one read at a time and one per REFRESH_MS; a change during a
 * read triggers one more read afterwards (a read is never aborted for a newer
 * one, so that a busy asset still gets its details).
 */
function useAsset(il: string, summary: Summary | undefined) {
  const [asset, setAsset] = useState<Asset | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<Reader | null>(null);
  useEffect(() => {
    const r: Reader = { ctl: new AbortController(), busy: false, dirty: false, timer: null, last: 0 };
    run.current = r;
    return () => {
      r.ctl.abort();
      if (r.timer !== null) {
        window.clearTimeout(r.timer);
      }
      run.current = null;
    };
  }, [il]);
  useEffect(() => {
    const r = run.current;
    if (r === null) {
      return;
    }
    const read = () => {
      r.timer = null;
      r.busy = true;
      r.last = Date.now();
      fetchAsset(il, r.ctl.signal)
        .then(
          (a) => {
            setAsset(a);
            setError(null);
          },
          (e: unknown) => {
            if (!r.ctl.signal.aborted) {
              setError(e instanceof Error ? e.message : String(e));
            }
          },
        )
        .finally(() => {
          r.busy = false;
          if (r.dirty && !r.ctl.signal.aborted) {
            r.dirty = false;
            schedule();
          }
        });
    };
    const schedule = () => {
      if (r.busy) {
        r.dirty = true;
      } else if (r.timer === null) {
        r.timer = window.setTimeout(read, Math.max(0, r.last + REFRESH_MS - Date.now()));
      }
    };
    schedule();
  }, [il, summary]);
  return { asset, error };
}

export type Tab = "overview" | "nameplate" | "interfaces" | "data" | "conformity" | "events";

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3>
        <span>{title}</span>
        {note && <span className="note">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="fields">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === "" || v === undefined || v === null ? <span className="muted">–</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Tile({ label, children, foot, tone }: { label: string; children: ReactNode; foot?: ReactNode; tone?: string }) {
  return (
    <div className={`tile${tone ? ` tile-${tone}` : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{children}</div>
      {foot && <div className="tile-foot">{foot}</div>}
    </div>
  );
}

/** The HealthScore as a bar (SVG attributes, no inline style: CSP). */
function Score({ score, tone }: { score: number; tone: string }) {
  const w = Math.max(0, Math.min(100, score));
  return (
    <svg className="score-bar" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={`HealthScore ${score}`}>
      <rect className="score-track" x="0" y="0" width="100" height="6" rx="3" />
      <rect className={`score-fill tone-${tone}`} x="0" y="0" width={w} height="6" rx="3" />
    </svg>
  );
}

function Overview({ s, asset, live }: { s: Summary; asset: Asset | null | undefined; live: Live }) {
  const now = Date.now() + live.skew;
  const health = s.health;
  return (
    <>
      <div className="tiles">
        <Tile
          label="Availability"
          tone={s.availability === "online" ? "ok" : s.availability === "offlineGraceful" ? undefined : "bad"}
          foot={
            s.availability === "online" && s.onlineSince !== null
              ? `for ${duration(now - s.onlineSince)}`
              : `last message ${ago(s.lastSeen, live.skew)}`
          }
        >
          {availabilityLabel(s.availability)}
        </Tile>
        <Tile
          label="Health"
          tone={health ? healthTone(health.Health) : undefined}
          foot={
            health?.HealthScore !== undefined ? (
              <Score score={health.HealthScore} tone={healthTone(health.Health)} />
            ) : health ? (
              "no HealthScore"
            ) : (
              "not received yet"
            )
          }
        >
          {health ? healthLabel(health.Health) : "Unknown"}
          {health?.HealthScore !== undefined && <span className="tile-unit">{health.HealthScore}</span>}
        </Tile>
        <Tile
          label="Messaging level"
          tone="level"
          foot={
            s.observed === null
              ? "not observed yet"
              : s.observed.missing.length > 0
                ? `next: ${s.observed.missing.length} REQ missing`
                : s.observed.level >= 3
                  ? "highest level"
                  : "observed, informative"
          }
        >
          {s.observed ? `L${s.observed.level}` : "–"}
        </Tile>
        <Tile
          label="Schema conformity"
          tone={s.conformity ? (s.conformity.violations > 0 ? "bad" : "ok") : undefined}
          foot={s.conformity ? `${s.conformity.messages} messages checked` : "nothing checked yet"}
        >
          {s.conformity ? (s.conformity.violations > 0 ? `${s.conformity.violations} violations` : "No violation") : "–"}
        </Tile>
      </div>

      <Section title="Health history" note={live.directory ? `last ${live.directory.limits.healthHistory} changes` : undefined}>
        {asset ? <HealthChart history={asset.healthHistory} now={now} /> : <p className="muted">Loading …</p>}
      </Section>

      {health?.Details && health.Details.length > 0 && (
        <Section title="Health details">
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Health</th>
                  <th>DiagnosticCode</th>
                  <th>Location</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {health.Details.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <Badge tone={healthTone(d.Health)}>{healthLabel(d.Health)}</Badge>
                    </td>
                    <td className="mono">{d.DiagnosticCode ?? "–"}</td>
                    <td>{d.Location ?? "–"}</td>
                    <td className="wrap">{d.Description ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Lifecycle">
        <Fields
          rows={[
            ["State", <AvailabilityBadge a={s.availability} />],
            ["Available (MG A1)", s.available ? "Yes – online with MAM and Health" : "No"],
            ["Online since", s.onlineSince === null ? "" : `${time(s.onlineSince)} (${ago(s.onlineSince, live.skew)})`],
            ["First seen", `${time(s.firstSeen)} (${ago(s.firstSeen, live.skew)})`],
            ["Last message", `${time(s.lastSeen)} (${ago(s.lastSeen, live.skew)})`],
            ...(s.kind === "device"
              ? ([["Published by", <AssetLink il={s.publisher} assets={live.assets} />]] as [string, ReactNode][])
              : []),
          ]}
        />
      </Section>

      {s.kind === "application" && (
        <Section title="Devices" note={`${s.devices.length} represented by this application`}>
          {s.devices.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="mini-list">
              {s.devices.map((d) => {
                const ds = live.assets.get(d);
                return (
                  <li key={d}>
                    {ds && <AvailabilityDot a={ds.availability} />}
                    <AssetLink il={d} assets={live.assets} />
                    {ds && <HealthBadge health={ds.health} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}

function Nameplate({ mam }: { mam: Mam | null }) {
  if (!mam) {
    return <Empty title="No MAM received yet">The registry requests the MAM with a Get when it sees the asset.</Empty>;
  }
  return (
    <>
      <div className="plate">
        <div>
          <div className="plate-maker">{text(mam.Manufacturer) || mam.ManufacturerUri}</div>
          <div className="plate-model">{text(mam.Model)}</div>
          {text(mam.Description) !== "" && <p className="muted">{text(mam.Description)}</p>}
        </div>
        <dl className="plate-ids">
          <div>
            <dt>ProductCode</dt>
            <dd className="mono">{mam.ProductCode || "–"}</dd>
          </div>
          <div>
            <dt>SerialNumber</dt>
            <dd className="mono">{mam.SerialNumber || "–"}</dd>
          </div>
        </dl>
      </div>
      <Section title="Master Asset Model">
        <Fields
          rows={[
            ["Manufacturer", text(mam.Manufacturer)],
            ["ManufacturerUri", mam.ManufacturerUri],
            ["Model", text(mam.Model)],
            ["ProductCode", mam.ProductCode],
            ["SerialNumber", <span className="mono">{mam.SerialNumber}</span>],
            ["HardwareRevision", mam.HardwareRevision],
            ["SoftwareRevision", mam.SoftwareRevision],
            ["DeviceRevision", mam.DeviceRevision],
            ["DeviceClass", mam.DeviceClass],
            ["ProductInstanceUri", <span className="mono">{mam.ProductInstanceUri}</span>],
            // Shown as text, not as a link: the UI leads nowhere outside the registry.
            ["DeviceManual", mam.DeviceManual ? <span className="mono">{mam.DeviceManual}</span> : ""],
            ["RevisionCounter", String(mam.RevisionCounter)],
            ["Description", text(mam.Description)],
            ["GlobalAssetId", mam.GlobalAssetId ? <span className="mono">{mam.GlobalAssetId}</span> : ""],
          ]}
        />
      </Section>
    </>
  );
}

const RESOURCES = ["MAM", "Health", "Profile", "PublicationList", "SubscriptionList"];

function Publications({ list, live }: { list: PublicationEntry[]; live: Live }) {
  const [resource, setResource] = useState("");
  const resources = useMemo(() => [...new Set(list.map((p) => p.Resource))].sort(), [list]);
  const shown = resource === "" ? list : list.filter((p) => p.Resource === resource);
  return (
    <>
      <div className="chip-filter" role="group" aria-label="Resource">
        <button type="button" className={resource === "" ? "on" : ""} onClick={() => setResource("")}>
          All <span className="count">{list.length}</span>
        </button>
        {resources.map((r) => (
          <button key={r} type="button" className={resource === r ? "on" : ""} onClick={() => setResource(r)}>
            {r} <span className="count">{list.filter((p) => p.Resource === r).length}</span>
          </button>
        ))}
      </div>
      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Source</th>
              <th>Filter</th>
              <th className="num" title="DataSetWriterId">Id</th>
              <th>Mode · Interval</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={i}>
                <td>
                  <span className="res">{p.Resource}</span>
                </td>
                <td>
                  <AssetLink il={p.Source} assets={live.assets} />
                </td>
                <td className="mono nowrap">{p.Filter ?? "–"}</td>
                <td className="num mono">{p.DataSetWriterId}</td>
                <td className="nowrap" title={p.Mode}>
                  {enumText(p.Mode)}
                  {p.Interval !== undefined && <div className="small muted">every {p.Interval} ms</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TopicCell({ topic, live }: { topic: string; live: Live }) {
  const t = parseTopic(topic);
  if (t === null) {
    return <span className="mono wrap">{topic}</span>;
  }
  const app = live.assets.has(t.appId) ? <AssetLink il={t.appId} assets={live.assets} /> : <span className="mono">{t.appId}</span>;
  return (
    <div className="topic" title={topic}>
      <span className="topic-main">
        <span className="res">{t.method}</span>
        {t.resource && <span className="res res-alt">{t.resource}</span>}
        {t.filter && <span className="mono small">{t.filter}</span>}
      </span>
      <span className="small muted">
        {t.serviceType} · {app}
        {t.source !== null && t.source !== t.appId && (
          <>
            {" "}
            → {live.assets.has(t.source) ? <AssetLink il={t.source} assets={live.assets} /> : <span className="mono">{t.source}</span>}
          </>
        )}
      </span>
    </div>
  );
}

function Interfaces({ asset, live }: { asset: Asset | null | undefined; live: Live }) {
  if (!asset) {
    return <p className="muted">Loading …</p>;
  }
  const answers = RESOURCES.filter((r) => asset.answers[r] !== undefined);
  return (
    <>
      <Section title="Profile" note="the resources the asset supports">
        {asset.profile === null ? (
          <p className="muted">No Profile received yet.</p>
        ) : (
          <div className="chips">
            {asset.profile.map((r) => (
              <span key={r} className="res">
                {r}
              </span>
            ))}
          </div>
        )}
      </Section>
      {answers.length > 0 && (
        <Section title="Answers to the registry" note="the registry reads with Get only">
          <div className="answers">
            {answers.map((r) => {
              const a = asset.answers[r];
              return (
                <div key={r} className={`answer tone-${a?.outcome === "answered" ? "ok" : "warn"}`} title={a?.reason}>
                  <Icon name={a?.outcome === "answered" ? "check" : "close"} />
                  <span className="answer-text">
                    <b>Get {r}</b>
                    <span className="small">{a?.outcome}</span>
                  </span>
                </div>
              );
            })}
          </div>
          {answers.some((r) => asset.answers[r]?.reason) && (
            <ul className="small muted">
              {answers
                .filter((r) => asset.answers[r]?.reason)
                .map((r) => (
                  <li key={r}>
                    {r}: {asset.answers[r]?.reason}
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}
      <Section title="PublicationList" note={asset.publications ? `${asset.publications.length} entries` : undefined}>
        {asset.publications === null ? (
          <p className="muted">Not received.</p>
        ) : asset.publications.length === 0 ? (
          <p className="muted">Empty.</p>
        ) : (
          <Publications list={asset.publications} live={live} />
        )}
      </Section>
      <Section title="SubscriptionList" note={asset.subscriptions ? `${asset.subscriptions.length} entries` : undefined}>
        {asset.subscriptions === null ? (
          <p className="muted">Not received.</p>
        ) : asset.subscriptions.length === 0 ? (
          <p className="muted">Empty.</p>
        ) : (
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className="num">Interval</th>
                  <th>Config</th>
                </tr>
              </thead>
              <tbody>
                {asset.subscriptions.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <TopicCell topic={p.TopicPath} live={live} />
                    </td>
                    <td className="num">{p.Interval === undefined ? "–" : `${p.Interval} ms`}</td>
                    <td title={p.Config}>{enumText(p.Config)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function Conformity({ s, asset }: { s: Summary; asset: Asset | null | undefined }) {
  return (
    <>
      <p className="notice">
        Informative only: the observed level and the schema counters are no verdict. A conformity verdict is the result
        of the D7 test tool <span className="mono">oec-check</span>.
      </p>
      <Section title="Observed Messaging level">
        {s.observed ? (
          <>
            <div className="levels" role="img" aria-label={`Observed level ${s.observed.level} of 3`}>
              {[0, 1, 2, 3].map((l) => (
                <span key={l} className={`level-step${l <= (s.observed?.level ?? -1) ? " on" : ""}`}>
                  L{l}
                </span>
              ))}
            </div>
            <Fields
              rows={[
                [
                  "Missing for the next level",
                  s.observed.missing.length === 0 ? (
                    s.observed.level >= 3 ? (
                      "Nothing – highest level"
                    ) : (
                      ""
                    )
                  ) : (
                    <span className="chips">
                      {s.observed.missing.map((m) => (
                        <span key={m} className="res res-warn">
                          {m}
                        </span>
                      ))}
                    </span>
                  ),
                ],
              ]}
            />
          </>
        ) : (
          <p className="muted">Not observed yet.</p>
        )}
      </Section>
      <Section title="Schema conformity" note="checked against the D1 schemas">
        {s.conformity ? (
          <Fields
            rows={[
              ["Messages checked", String(s.conformity.messages)],
              ["Violations", <ConformityBadge c={s.conformity} />],
            ]}
          />
        ) : (
          <p className="muted">No message checked yet.</p>
        )}
        {asset?.violations && asset.violations.length > 0 && (
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Topic</th>
                  <th>Requirements</th>
                  <th>First error</th>
                </tr>
              </thead>
              <tbody>
                {[...asset.violations].reverse().map((v, i) => (
                  <tr key={i}>
                    <td className="nowrap">{time(v.at)}</td>
                    <td className="mono wrap small">{v.topic}</td>
                    <td className="mono">{v.reqs.join(", ")}</td>
                    <td className="wrap">{v.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

export function AssetDetail({
  il,
  summary,
  live,
  data,
  tab,
  onTab,
}: {
  il: string;
  summary: Summary | undefined;
  live: Live;
  data: DataSets | null;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const { asset, error } = useAsset(il, summary);
  if (asset === null || (asset === undefined && summary === undefined && live.directory !== null)) {
    return (
      <div className="detail-body">
        <div className="detail-close">
          <a href="#/" className="icon-button" aria-label="Close" title="Close (Esc)">
            <Icon name="close" />
          </a>
        </div>
        <Empty title="Unknown asset">
          The registry has not seen <span className="mono">{il}</span>.
        </Empty>
      </div>
    );
  }
  const s: Summary | undefined = asset ?? summary;
  if (s === undefined) {
    return <p className="muted pad">Loading …</p>;
  }
  const events = live.events.filter((e) => e.source === il);
  const violations = s.conformity?.violations ?? 0;
  const records = data?.dataSets.filter((r) => r.source === il) ?? [];
  const tabs: [Tab, string, ReactNode][] = [
    ["overview", "Overview", null],
    ["nameplate", "Nameplate", null],
    ["interfaces", "Interfaces", null],
    ["data", "Data", records.length > 0 ? <span className="count">{records.length}</span> : null],
    ["conformity", "Conformity", violations > 0 ? <span className="count bad">{violations}</span> : null],
    ["events", "Events", events.length > 0 ? <span className="count">{events.length}</span> : null],
  ];
  return (
    <div className="detail-body">
      <header className="detail-head">
        <div className="detail-kicker">
          <KindBadge s={s} />
          {s.kind === "device" && (
            <span className="small muted">
              via <AssetLink il={s.publisher} assets={live.assets} />
            </span>
          )}
        </div>
        <h2>
          <AssetName il={s.il} />
        </h2>
        <div className="il">
          <span className="mono" title="Identification Link (Oi4Identifier)">
            {s.il}
          </span>
          <CopyButton value={s.il} label="Copy IL" />
        </div>
        <div className="chips">
          <AvailabilityBadge a={s.availability} />
          <HealthBadge health={s.health} />
          <LevelBadge observed={s.observed} />
          {s.conformity && <ConformityBadge c={s.conformity} />}
        </div>
        <a href="#/" className="icon-button detail-x" aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </a>
      </header>
      {error && <p className="error">Could not read the asset: {error}</p>}
      <div className="tabs" role="tablist" aria-label="Asset details">
        {tabs.map(([t, l, extra]) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="tabpanel"
            className={tab === t ? "on" : ""}
            onClick={() => onTab(t)}
          >
            {l}
            {extra}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <Overview s={s} asset={asset} live={live} />}
        {tab === "nameplate" && <Nameplate mam={s.mam} />}
        {tab === "interfaces" && <Interfaces asset={asset} live={live} />}
        {tab === "data" &&
          (data === null ? (
            <p className="muted pad">Loading …</p>
          ) : records.length === 0 ? (
            <Empty title="No Data with this asset as Source">
              The last value of every Data DataSet about this asset appears here once it is published on the bus.
            </Empty>
          ) : (
            <DataCards records={records} live={live} showSource={false} />
          ))}
        {tab === "conformity" && <Conformity s={s} asset={asset} />}
        {tab === "events" &&
          (events.length === 0 ? (
            <Empty title="No Event with this asset as Source" />
          ) : (
            <EventTable events={events} assets={live.assets} showSource={false} skew={live.skew} />
          ))}
      </div>
    </div>
  );
}
