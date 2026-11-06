import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchAsset, type Asset, type Mam, type Summary } from "./api";
import { EventTable } from "./EventList";
import { HealthChart } from "./HealthChart";
import { ago, enumName, healthLabel, nameOf, text, time } from "./format";
import type { Live } from "./live";
import { AssetLink, AvailabilityBadge, ConformityBadge, HealthBadge, LevelBadge } from "./parts";

/** At most one read of the asset per this time while its summary changes. */
const REFRESH_MS = 1000;

/** Reads `/api/assets/{il}` again whenever the live summary of the asset changes. */
function useAsset(il: string, summary: Summary | undefined) {
  const [asset, setAsset] = useState<Asset | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const ctl = new AbortController();
    const wait = Math.max(0, last.current + REFRESH_MS - Date.now());
    const t = window.setTimeout(() => {
      last.current = Date.now();
      fetchAsset(il, ctl.signal).then(
        (a) => {
          setAsset(a);
          setError(null);
        },
        (e: unknown) => {
          if (!ctl.signal.aborted) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      );
    }, wait);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [il, summary]);
  return { asset, error };
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>
        {title}
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

function MamFields({ mam }: { mam: Mam }) {
  return (
    <Fields
      rows={[
        ["Manufacturer", text(mam.Manufacturer)],
        ["ManufacturerUri", mam.ManufacturerUri],
        ["Model", text(mam.Model)],
        ["ProductCode", mam.ProductCode],
        ["SerialNumber", mam.SerialNumber],
        ["HardwareRevision", mam.HardwareRevision],
        ["SoftwareRevision", mam.SoftwareRevision],
        ["DeviceRevision", mam.DeviceRevision],
        ["DeviceClass", mam.DeviceClass],
        ["ProductInstanceUri", <span className="mono">{mam.ProductInstanceUri}</span>],
        // Shown as text, not as a link: the UI leads nowhere outside the registry.
        ["DeviceManual", mam.DeviceManual ? <span className="mono">{mam.DeviceManual}</span> : ""],
        ["RevisionCounter", String(mam.RevisionCounter)],
        ["Description", text(mam.Description)],
        ["GlobalAssetId", mam.GlobalAssetId ?? ""],
      ]}
    />
  );
}

const RESOURCES = ["MAM", "Health", "Profile", "PublicationList", "SubscriptionList"];

export function AssetDetail({ il, summary, live }: { il: string; summary: Summary | undefined; live: Live }) {
  const { asset, error } = useAsset(il, summary);
  if (asset === null || (asset === undefined && summary === undefined && live.directory !== null)) {
    return (
      <div className="hint">
        <h2>Unknown asset</h2>
        <p className="mono">{il}</p>
        <p className="muted">The registry has not seen this asset.</p>
      </div>
    );
  }
  const s: Summary | undefined = asset ?? summary;
  if (s === undefined) {
    return <p className="muted">Loading …</p>;
  }
  const now = Date.now() + live.skew;
  const events = live.events.filter((e) => e.source === il);
  return (
    <div className="asset">
      <div className="bar">
        <h2>{nameOf(s)}</h2>
        <a href="#/" className="small" aria-label="Close">
          ✕ close
        </a>
      </div>
      <p className="mono small">{s.il}</p>
      {error && <p className="error">Could not read the asset: {error}</p>}
      <div className="chips">
        <span className="badge tone-none">{s.kind === "application" ? s.serviceType : "Device"}</span>
        <AvailabilityBadge a={s.availability} />
        <HealthBadge health={s.health} />
        <LevelBadge observed={s.observed} />
        {s.conformity && <ConformityBadge c={s.conformity} />}
      </div>

      <Section title="Availability">
        <Fields
          rows={[
            ["State", <AvailabilityBadge a={s.availability} />],
            ["Available (MG A1)", s.available ? "yes – online with MAM and Health" : "no"],
            ["Online since", s.onlineSince === null ? "" : `${time(s.onlineSince)} (${ago(s.onlineSince, live.skew)})`],
            ["First seen", time(s.firstSeen)],
            ["Last message", `${time(s.lastSeen)} (${ago(s.lastSeen, live.skew)})`],
            ...(s.kind === "device"
              ? ([["Published by", <AssetLink il={s.publisher} assets={live.assets} />]] as [string, ReactNode][])
              : []),
          ]}
        />
      </Section>

      <Section title="MAM">{s.mam ? <MamFields mam={s.mam} /> : <p className="muted">No MAM received yet.</p>}</Section>

      <Section title="Health">
        {s.health ? (
          <>
            <Fields
              rows={[
                ["Health", <HealthBadge health={s.health} />],
                ["HealthScore", s.health.HealthScore === undefined ? "" : String(s.health.HealthScore)],
              ]}
            />
            {s.health.Details && s.health.Details.length > 0 && (
              <table className="grid small">
                <thead>
                  <tr>
                    <th>Health</th>
                    <th>DiagnosticCode</th>
                    <th>Location</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {s.health.Details.map((d, i) => (
                    <tr key={i}>
                      <td>{healthLabel(d.Health)}</td>
                      <td className="mono">{d.DiagnosticCode ?? "–"}</td>
                      <td>{d.Location ?? "–"}</td>
                      <td className="wrap">{d.Description ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="muted">No Health received yet.</p>
        )}
      </Section>

      {asset && (
        <Section
          title="Health history"
          note={live.directory ? `last ${live.directory.limits.healthHistory} changes` : undefined}
        >
          <HealthChart history={asset.healthHistory} now={now} />
        </Section>
      )}

      {s.observed && (
        <Section title="Observed Messaging level" note="informative, not a verdict">
          <Fields
            rows={[
              ["Level", <LevelBadge observed={s.observed} />],
              [
                "Missing for the next level",
                s.observed.missing.length === 0 ? (
                  s.observed.level >= 3 ? (
                    "nothing (highest level)"
                  ) : (
                    ""
                  )
                ) : (
                  <span className="mono">{s.observed.missing.join(", ")}</span>
                ),
              ],
            ]}
          />
        </Section>
      )}

      {s.conformity && (
        <Section title="Schema conformity" note="informative, checked against the D1 schemas">
          <Fields
            rows={[
              ["Messages checked", String(s.conformity.messages)],
              ["Violations", String(s.conformity.violations)],
            ]}
          />
          {asset?.violations && asset.violations.length > 0 && (
            <table className="grid small">
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
                    <td className="mono wrap">{v.topic}</td>
                    <td className="mono">{v.reqs.join(", ")}</td>
                    <td className="wrap">{v.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {asset && (
        <Section title="Profile and answers" note="the registry reads with Get only">
          <Fields
            rows={[
              [
                "Profile",
                asset.profile === null ? (
                  ""
                ) : (
                  <span className="chips">
                    {asset.profile.map((r) => (
                      <span key={r} className="badge tone-none">
                        {r}
                      </span>
                    ))}
                  </span>
                ),
              ],
              ...RESOURCES.filter((r) => asset.answers[r] !== undefined).map((r): [string, ReactNode] => {
                const a = asset.answers[r];
                return [
                  `Get ${r}`,
                  a === undefined ? (
                    ""
                  ) : (
                    <span className={`badge tone-${a.outcome === "answered" ? "ok" : "warn"}`}>
                      {a.outcome}
                      {a.reason ? `: ${a.reason}` : ""}
                    </span>
                  ),
                ];
              }),
            ]}
          />
        </Section>
      )}

      {asset?.publications && (
        <Section title="PublicationList">
          {asset.publications.length === 0 ? (
            <p className="muted">Empty.</p>
          ) : (
            <div className="scroll">
              <table className="grid small">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Source</th>
                    <th>Filter</th>
                    <th>DataSetWriterId</th>
                    <th>Mode</th>
                    <th>Interval</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.publications.map((p, i) => (
                    <tr key={i}>
                      <td>{p.Resource}</td>
                      <td>
                        <AssetLink il={p.Source} assets={live.assets} />
                      </td>
                      <td className="mono">{p.Filter ?? "–"}</td>
                      <td>{p.DataSetWriterId}</td>
                      <td>{enumName(p.Mode)}</td>
                      <td>{p.Interval === undefined ? "–" : `${p.Interval} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {asset?.subscriptions && (
        <Section title="SubscriptionList">
          {asset.subscriptions.length === 0 ? (
            <p className="muted">Empty.</p>
          ) : (
            <table className="grid small">
              <thead>
                <tr>
                  <th>TopicPath</th>
                  <th>Interval</th>
                  <th>Config</th>
                </tr>
              </thead>
              <tbody>
                {asset.subscriptions.map((p, i) => (
                  <tr key={i}>
                    <td className="mono wrap">{p.TopicPath}</td>
                    <td>{p.Interval === undefined ? "–" : `${p.Interval} ms`}</td>
                    <td>{enumName(p.Config)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {s.kind === "application" && (
        <Section title="Devices">
          {s.devices.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="list">
              {s.devices.map((d) => (
                <li key={d}>
                  <AssetLink il={d} assets={live.assets} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Events" note="with this asset as Source">
        <EventTable events={events} assets={live.assets} showSource={false} />
      </Section>
    </div>
  );
}
