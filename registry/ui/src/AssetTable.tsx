import { Fragment, useMemo, useState } from "react";
import type { Summary } from "./api";
import { ago, nameOf } from "./format";
import type { Live } from "./live";
import { AvailabilityBadge, ConformityBadge, HealthBadge, LevelBadge, assetHref } from "./parts";

function matches(s: Summary, q: string): boolean {
  if (q === "") {
    return true;
  }
  const hay = `${nameOf(s)} ${s.il} ${s.serviceType} ${s.mam?.Manufacturer.Text ?? ""}`.toLowerCase();
  return hay.includes(q);
}

const byName = (a: Summary, b: Summary) => nameOf(a).localeCompare(nameOf(b)) || a.il.localeCompare(b.il);

interface Group {
  app: Summary | null;
  devices: Summary[];
}

/** Applications sorted by name, each with the devices it represents. */
function groups(assets: ReadonlyMap<string, Summary>, q: string): Group[] {
  const out: Group[] = [];
  const placed = new Set<string>();
  const apps = [...assets.values()].filter((s) => s.kind === "application").sort(byName);
  for (const app of apps) {
    const devices = app.devices
      .map((il) => assets.get(il))
      .filter((d): d is Summary => d !== undefined && d.kind === "device")
      .sort(byName);
    devices.forEach((d) => placed.add(d.il));
    const shown = devices.filter((d) => matches(d, q));
    if (matches(app, q) || shown.length > 0) {
      out.push({ app, devices: matches(app, q) ? devices : shown });
    }
  }
  const rest = [...assets.values()]
    .filter((s) => s.kind === "device" && !placed.has(s.il) && matches(s, q))
    .sort(byName);
  if (rest.length > 0) {
    out.push({ app: null, devices: rest });
  }
  return out;
}

function Row({ s, live, selected, nested }: { s: Summary; live: Live; selected: boolean; nested: boolean }) {
  return (
    <tr className={selected ? "sel" : undefined}>
      <td className={nested ? "nested" : undefined}>
        <a href={assetHref(s.il)}>{nameOf(s)}</a>
        <div className="mono small muted">{s.il}</div>
      </td>
      <td>{s.kind === "application" ? s.serviceType : "Device"}</td>
      <td>
        <AvailabilityBadge a={s.availability} />
      </td>
      <td>
        <HealthBadge health={s.health} />
      </td>
      <td>
        <LevelBadge observed={s.observed} />
      </td>
      <td>
        <ConformityBadge c={s.conformity} />
      </td>
      <td className="small" title={new Date(s.lastSeen).toISOString()}>
        {ago(s.lastSeen, live.skew)}
      </td>
    </tr>
  );
}

export function AssetTable({ live, selected }: { live: Live; selected: string | null }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const gs = useMemo(() => groups(live.assets, q), [live.assets, q]);
  return (
    <>
      <div className="bar">
        <h2>Applications and devices</h2>
        <input
          type="search"
          placeholder="Filter by name, IL, ServiceType …"
          aria-label="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {live.assets.size === 0 ? (
        <p className="muted">{live.directory ? "No asset seen yet." : "Waiting for the registry …"}</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Name / IL</th>
                <th>ServiceType</th>
                <th>Availability</th>
                <th>Health</th>
                <th title="Observed Messaging level (informative)">Level</th>
                <th title="Schema violations / checked messages (informative)">Conformity</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {gs.map((g) => (
                <Fragment key={g.app?.il ?? "-"}>
                  {g.app ? (
                    <Row s={g.app} live={live} selected={g.app.il === selected} nested={false} />
                  ) : (
                    <tr>
                      <td colSpan={7} className="muted small">
                        Devices without a known application
                      </td>
                    </tr>
                  )}
                  {g.devices.map((d) => (
                    <Row key={d.il} s={d} live={live} selected={d.il === selected} nested={true} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
