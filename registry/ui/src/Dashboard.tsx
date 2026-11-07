import { useMemo } from "react";
import type { HealthState, Summary } from "./api";
import { EventTable } from "./EventList";
import { HEALTH_STATES, healthLabel, healthTone, needsAttention } from "./format";
import type { Live } from "./live";
import { Atom, CommunityBadge } from "./logo";
import { AssetLink, AvailabilityDot, HealthBadge, Icon } from "./parts";

/** A stacked bar of counts (SVG attributes, no inline style: CSP). */
function Stack({ parts, label }: { parts: { key: string; n: number; tone: string; label: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  let x = 0;
  return (
    <svg className="stack" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={label}>
      <rect className="stack-track" x="0" y="0" width="100" height="10" rx="5" />
      {total > 0 &&
        parts
          .filter((p) => p.n > 0)
          .map((p) => {
            const w = (p.n / total) * 100;
            const r = <rect key={p.key} className={`stack-part tone-${p.tone}`} x={x} y="0" width={w} height="10" />;
            x += w;
            return r;
          })}
    </svg>
  );
}

export function Dashboard({ live }: { live: Live }) {
  const stats = useMemo(() => {
    const health = new Map<HealthState | "unknown", number>();
    const levels = [0, 0, 0, 0];
    const types = new Map<string, number>();
    const attention: Summary[] = [];
    for (const a of live.assets.values()) {
      const h = a.health?.Health ?? "unknown";
      health.set(h, (health.get(h) ?? 0) + 1);
      if (a.observed && a.observed.level >= 0 && a.observed.level <= 3) {
        levels[a.observed.level] = (levels[a.observed.level] ?? 0) + 1;
      }
      if (a.kind === "application") {
        types.set(a.serviceType, (types.get(a.serviceType) ?? 0) + 1);
      }
      if (needsAttention(a)) {
        attention.push(a);
      }
    }
    return { health, levels, types: [...types].sort((a, b) => b[1] - a[1]), attention };
  }, [live.assets]);
  const healthParts = [
    ...HEALTH_STATES.map((h) => ({ key: h, n: stats.health.get(h) ?? 0, tone: healthTone(h), label: healthLabel(h) })),
    { key: "unknown", n: stats.health.get("unknown") ?? 0, tone: "none", label: "Unknown" },
  ];
  const maxType = Math.max(1, ...stats.types.map(([, n]) => n));
  const d = live.directory;
  return (
    <div className="detail-body dashboard">
      <header className="welcome">
        <Atom className="welcome-mark" />
        <div>
          <h2>Overview</h2>
          <p className="muted">
            The registry lists every application and device it observes on the OEC Message Bus. Select an asset for its
            nameplate, Health, interfaces and conformity.
          </p>
        </div>
      </header>

      <section className="section">
        <h3>
          <span>Health</span>
          <span className="note">{live.assets.size} assets</span>
        </h3>
        <Stack parts={healthParts} label="Health of all assets" />
        <ul className="legend">
          {healthParts
            .filter((p) => p.n > 0)
            .map((p) => (
              <li key={p.key}>
                <i className={`swatch tone-${p.tone}`} />
                {p.label} <b>{p.n}</b>
              </li>
            ))}
        </ul>
      </section>

      <section className="section">
        <h3>
          <span>Needs attention</span>
          <span className="note">offline, Health not normal or schema violations</span>
        </h3>
        {stats.attention.length === 0 ? (
          <p className="all-good">
            <Icon name="check" /> All assets are online, healthy and without schema violations.
          </p>
        ) : (
          <ul className="mini-list">
            {stats.attention.map((a) => (
              <li key={a.il}>
                <AvailabilityDot a={a.availability} />
                <AssetLink il={a.il} assets={live.assets} />
                <HealthBadge health={a.health} />
                {a.conformity && a.conformity.violations > 0 && (
                  <span className="badge tone-bad">{a.conformity.violations} violations</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="two">
        <section className="section">
          <h3>
            <span>Applications by ServiceType</span>
          </h3>
          {stats.types.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="bars">
              {stats.types.map(([t, n]) => (
                <li key={t}>
                  <span>{t}</span>
                  <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="bar-fill" x="0" y="0" width={(n / maxType) * 100} height="8" rx="4" />
                  </svg>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="section">
          <h3>
            <span>Observed Messaging level</span>
            <span className="note">informative</span>
          </h3>
          <ul className="bars">
            {stats.levels.map((n, l) => (
              <li key={l}>
                <span>Level {l}</span>
                <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                  <rect className="bar-fill level" x="0" y="0" width={(n / Math.max(1, ...stats.levels)) * 100} height="8" rx="4" />
                </svg>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="section">
        <h3>
          <span>Latest Events</span>
          <a className="note link-arrow" href="#/events">
            All Events <Icon name="arrow" />
          </a>
        </h3>
        <EventTable events={live.events} assets={live.assets} showSource={true} skew={live.skew} limit={5} />
      </section>

      {d && (
        <section className="section">
          <h3>
            <span>This registry</span>
          </h3>
          <dl className="fields">
            <div>
              <dt>AppId</dt>
              <dd className="mono">{d.registry}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{d.version}</dd>
            </div>
            <div>
              <dt>Kept</dt>
              <dd>
                {d.limits.eventTrail} Events, {d.limits.healthHistory} Health changes and {d.limits.violationTrail}{" "}
                violations per asset
              </dd>
            </div>
            <div>
              <dt>Ignored messages</dt>
              <dd title="Messages since the start that are not parseable or not of the expected form">{d.ignored}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="section community-note" aria-label="About">
        <CommunityBadge className="community-badge" />
        <div>
          <p>
            <b>A community project.</b> The OEC Registry is developed by the OI4 Open Edge Computing community; it is
            not an official product of the Open Industry 4.0 Alliance.
          </p>
          <p className="muted small">The OI4 logo is a trademark of the Open Industry 4.0 Alliance.</p>
        </div>
      </section>
    </div>
  );
}
