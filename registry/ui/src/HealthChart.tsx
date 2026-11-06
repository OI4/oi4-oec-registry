import type { Health, HealthState } from "./api";
import { healthLabel, healthTone, time } from "./format";

/** The rows of the chart, from good (top) to bad (bottom). */
const ROWS: HealthState[] = ["NORMAL_0", "MAINTENANCE_REQUIRED_4", "OFF_SPEC_3", "CHECK_FUNCTION_2", "FAILURE_1"];

const W = 640;
const H = 150;
const LEFT = 150;
const RIGHT = 10;
const TOP = 10;
const ROW = 26;

/**
 * The Health history as a step chart (SVG, no inline styles: CSP). `now` is the
 * registry time, the end of the last state.
 */
export function HealthChart({ history, now }: { history: { at: number; health: Health }[]; now: number }) {
  if (history.length === 0) {
    return <p className="muted">No Health received yet.</p>;
  }
  const first = history[0]?.at ?? now;
  const end = Math.max(now, history[history.length - 1]?.at ?? now);
  const span = Math.max(1, end - first);
  const x = (t: number) => LEFT + ((t - first) / span) * (W - LEFT - RIGHT);
  const y = (h: HealthState) => TOP + Math.max(0, ROWS.indexOf(h)) * ROW + ROW / 2;
  const segments = history.map((p, i) => {
    const next = history[i + 1];
    return { from: p.at, to: next ? next.at : end, state: p.health.Health, next: next?.health.Health };
  });
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Health history">
      {ROWS.map((r) => (
        <g key={r}>
          <line className="chart-grid" x1={LEFT} x2={W - RIGHT} y1={y(r)} y2={y(r)} />
          <text className="chart-label" x={LEFT - 8} y={y(r) + 4} textAnchor="end">
            {healthLabel(r)}
          </text>
        </g>
      ))}
      {segments.map((s, i) => (
        <g key={i}>
          <line
            className={`chart-step tone-${healthTone(s.state)}`}
            x1={x(s.from)}
            x2={x(s.to)}
            y1={y(s.state)}
            y2={y(s.state)}
          />
          {s.next !== undefined && (
            <line className="chart-jump" x1={x(s.to)} x2={x(s.to)} y1={y(s.state)} y2={y(s.next)} />
          )}
          <circle className={`chart-dot tone-${healthTone(s.state)}`} cx={x(s.from)} cy={y(s.state)} r={3.5}>
            <title>{`${time(s.from)}: ${healthLabel(s.state)}`}</title>
          </circle>
        </g>
      ))}
      <text className="chart-axis" x={LEFT} y={H - 4}>
        {time(first)}
      </text>
      <text className="chart-axis" x={W - RIGHT} y={H - 4} textAnchor="end">
        {time(end)}
      </text>
    </svg>
  );
}
