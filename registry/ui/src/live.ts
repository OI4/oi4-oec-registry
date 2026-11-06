// The live view of the directory: one EventSource on /api/stream. The first
// message is a snapshot; then `asset`, `event` and `directory` changes. After a
// lost connection the browser reconnects and the registry sends a new snapshot.
import { useEffect, useReducer } from "react";
import type { DirectoryFields, EventRecord, StreamMessage, Summary } from "./api";

export type Connection = "connecting" | "live" | "reconnecting";

export interface Live {
  connection: Connection;
  directory: DirectoryFields | null;
  assets: ReadonlyMap<string, Summary>;
  /** Ascending by `seq`, at most `limits.eventTrail`. */
  events: readonly EventRecord[];
  /** Registry time minus local time (ms), from the last snapshot. */
  skew: number;
}

type Action = { kind: "open" } | { kind: "error" } | { kind: "message"; msg: StreamMessage };

const initial: Live = {
  connection: "connecting",
  directory: null,
  assets: new Map(),
  events: [],
  skew: 0,
};

function trim(events: EventRecord[], limit: number): EventRecord[] {
  return events.length > limit ? events.slice(events.length - limit) : events;
}

function directoryOf(m: DirectoryFields): DirectoryFields {
  return { registry: m.registry, version: m.version, limits: m.limits, ignored: m.ignored };
}

function reduce(s: Live, a: Action): Live {
  switch (a.kind) {
    case "open":
      return s.connection === "live" ? s : { ...s, connection: "live" };
    case "error":
      return { ...s, connection: "reconnecting" };
    case "message": {
      const m = a.msg;
      switch (m.type) {
        case "snapshot":
          return {
            connection: "live",
            directory: directoryOf(m),
            assets: new Map(m.assets.map((x) => [x.il, x])),
            events: trim([...m.events], m.limits.eventTrail),
            skew: m.time - Date.now(),
          };
        case "directory": {
          const directory = directoryOf(m);
          const limit = directory.limits.eventTrail;
          return { ...s, directory, events: trim([...s.events], limit) };
        }
        case "asset": {
          const assets = new Map(s.assets);
          assets.set(m.asset.il, m.asset);
          return { ...s, assets };
        }
        case "event": {
          const last = s.events[s.events.length - 1];
          if (last !== undefined && m.event.seq <= last.seq) {
            return s;
          }
          const limit = s.directory?.limits.eventTrail ?? Number.MAX_SAFE_INTEGER;
          return { ...s, events: trim([...s.events, m.event], limit) };
        }
      }
    }
  }
}

/** A closed stream (e.g. refused) is opened again after this time. */
const RETRY_MS = 5000;

export function useLive(): Live {
  const [state, dispatch] = useReducer(reduce, initial);
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: number | undefined;
    let stopped = false;
    const open = () => {
      source = new EventSource("/api/stream");
      source.onopen = () => dispatch({ kind: "open" });
      source.onmessage = (e: MessageEvent<string>) => {
        try {
          dispatch({ kind: "message", msg: JSON.parse(e.data) as StreamMessage });
        } catch {
          // A message that is not JSON is ignored; the next snapshot repairs the view.
        }
      };
      source.onerror = () => {
        dispatch({ kind: "error" });
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          source = null;
          timer = window.setTimeout(open, RETRY_MS);
        }
      };
    };
    open();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      source?.close();
    };
  }, []);
  return state;
}
