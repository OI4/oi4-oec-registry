//! The HTTP API of the registry (ADR-0029 §7, increment 3), sans-IO: the
//! router, the request guards and the JSON views of the directory; the
//! server is [`crate::http`]. The directory is read-only (ADR-0008): its
//! resources answer `GET` only. Since C-113 (ADR-0035) every resource but
//! the Web UI files, the API documents, login and logout needs a session
//! of a user ([`crate::auth`]); a method a resource does not take is `405`
//! with its `Allow`.
//!
//! - `POST /api/login`, `POST /api/logout`, `GET /api/session`,
//!   `POST /api/password`: the session and the own password.
//! - `GET`/`POST /api/users`, `PUT`/`DELETE /api/users/{name}`: the users
//!   (role `admin`).
//!
//! - `GET /api/assets`: the directory – the registry, its limits, the
//!   count of ignored messages and a summary per asset.
//! - `GET /api/assets/{il}`: one asset in detail; `{il}` is its
//!   Identification Link percent-encoded as one path segment (the plain
//!   form with `/` is accepted too).
//! - `GET /api/events`: the Event trail, oldest first.
//! - `GET /api/stream`: an event stream (`text/event-stream`) of JSON
//!   messages with a member `type`: first a `snapshot`, then `asset`,
//!   `event` and `directory` changes; a comment `keep-alive` when quiet.
//! - `GET /api/openapi.json`, `GET /api/asyncapi.json`: the API documents.
//! - `GET /` and the other files of the Web UI (only on the Web UI port):
//!   the built `ui/dist/` embedded through the generated table
//!   [`crate::ui_assets`] (ADR-0029 §9, amendment C-089); `/` is
//!   `/index.html`.
//!
//! The JSON members are camelCase; the MG payloads (MAM, Health, Event,
//! PublicationList and SubscriptionList entries) are embedded as on the
//! bus. The schemas: `api/openapi.json`.

use std::collections::BTreeMap;
use std::hash::{BuildHasher, RandomState};

use serde_json::{Value, json};

use crate::directory::{
    Answer, Availability, Directory, Entry, EventRecord, Kind, Limits, Violation, Want,
};
use crate::ui_assets::UI_FILES;

/// The OpenAPI document (ADR-0029 §7).
pub(crate) const OPENAPI: &str = include_str!("../api/openapi.json");
/// The AsyncAPI document (ADR-0029 §7, C-087).
pub(crate) const ASYNCAPI: &str = include_str!("../api/asyncapi.json");

/// A file of the Web UI: its path (`/…`), content type and bytes.
#[derive(PartialEq, Eq)]
pub(crate) struct UiFile {
    pub(crate) path: &'static str,
    pub(crate) content_type: &'static str,
    pub(crate) bytes: &'static [u8],
}

impl std::fmt::Debug for UiFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "UiFile({}, {} octets)", self.path, self.bytes.len())
    }
}

/// The file of the Web UI at `path` (`/` is `/index.html`).
fn ui_file(path: &str) -> Option<&'static UiFile> {
    let path = if path == "/" { "/index.html" } else { path };
    UI_FILES.iter().find(|f| f.path == path)
}

/// At most this many request bodies are announced (ADR-0028 amendment
/// C-083); the resources that take a body take less ([`MAX_JSON`]).
pub(crate) const MAX_BODY: u64 = 64 * 1024;
/// The largest body of a resource that takes one (ADR-0035).
pub(crate) const MAX_JSON: usize = 4 * 1024;

/// A resource of the API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Route {
    /// A file of the Web UI, on the Web UI port only.
    Ui(&'static UiFile),
    Assets,
    /// `/api/assets/{il}`, the decoded Identification Link.
    Asset(String),
    Events,
    /// `/api/data`: the data logger.
    Data,
    Stream,
    OpenApi,
    AsyncApi,
    Login,
    Logout,
    Session,
    Password,
    Users,
    /// `/api/users/{name}`, the decoded name.
    User(String),
}

/// Who may use a resource (ADR-0035 §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Access {
    /// Anyone (the Web UI files, the API documents, login, logout).
    Public,
    /// A session, also one whose password must be changed first.
    Session,
    /// A session whose password need not be changed.
    Read,
    /// A session of an `admin` whose password need not be changed.
    Admin,
}

impl Route {
    /// The methods of the route.
    pub(crate) fn methods(&self) -> &'static [&'static str] {
        match self {
            Self::Login | Self::Logout | Self::Password => &["POST"],
            Self::Users => &["GET", "POST"],
            Self::User(_) => &["PUT", "DELETE"],
            _ => &["GET"],
        }
    }

    /// The value of `Allow` for the route.
    pub(crate) fn allow(&self) -> &'static str {
        match self.methods() {
            ["POST"] => "POST",
            ["GET", "POST"] => "GET, POST",
            ["PUT", "DELETE"] => "PUT, DELETE",
            _ => "GET",
        }
    }

    /// Who may use the route.
    pub(crate) fn access(&self) -> Access {
        match self {
            Self::Ui(_) | Self::OpenApi | Self::AsyncApi | Self::Login | Self::Logout => {
                Access::Public
            }
            Self::Session | Self::Password => Access::Session,
            Self::Users | Self::User(_) => Access::Admin,
            Self::Assets | Self::Asset(_) | Self::Events | Self::Data | Self::Stream => {
                Access::Read
            }
        }
    }
}

#[cfg(test)]
impl Route {
    /// The paths of the API, as in the OpenAPI document.
    pub(crate) const PATHS: [&'static str; 13] = [
        "/api/assets",
        "/api/assets/{il}",
        "/api/events",
        "/api/stream",
        "/api/openapi.json",
        "/api/asyncapi.json",
        "/api/data",
        "/api/login",
        "/api/logout",
        "/api/session",
        "/api/password",
        "/api/users",
        "/api/users/{name}",
    ];

    /// The path template of the route (`None`: not part of the API).
    pub(crate) fn template(&self) -> Option<&'static str> {
        Some(match self {
            Self::Ui(_) => return None,
            Self::Assets => Self::PATHS[0],
            Self::Asset(_) => Self::PATHS[1],
            Self::Events => Self::PATHS[2],
            Self::Stream => Self::PATHS[3],
            Self::OpenApi => Self::PATHS[4],
            Self::AsyncApi => Self::PATHS[5],
            Self::Data => Self::PATHS[6],
            Self::Login => Self::PATHS[7],
            Self::Logout => Self::PATHS[8],
            Self::Session => Self::PATHS[9],
            Self::Password => Self::PATHS[10],
            Self::Users => Self::PATHS[11],
            Self::User(_) => Self::PATHS[12],
        })
    }
}

/// The route of `path` (without query); `ui`: the Web UI port, which also
/// serves the files of the Web UI. `None`: not found.
pub(crate) fn route(path: &str, ui: bool) -> Option<Route> {
    if ui
        && !path.starts_with("/api/")
        && let Some(f) = ui_file(path)
    {
        return Some(Route::Ui(f));
    }
    Some(match path {
        "/api/assets" => Route::Assets,
        "/api/events" => Route::Events,
        "/api/data" => Route::Data,
        "/api/stream" => Route::Stream,
        "/api/openapi.json" => Route::OpenApi,
        "/api/asyncapi.json" => Route::AsyncApi,
        "/api/login" => Route::Login,
        "/api/logout" => Route::Logout,
        "/api/session" => Route::Session,
        "/api/password" => Route::Password,
        "/api/users" => Route::Users,
        _ => {
            if let Some(raw) = path.strip_prefix("/api/users/") {
                let name = percent_decode(raw)?;
                return (!name.is_empty() && !name.contains('/')).then_some(Route::User(name));
            }
            let raw = path.strip_prefix("/api/assets/")?;
            let il = percent_decode(raw)?;
            if il.is_empty() {
                return None;
            }
            Route::Asset(il)
        }
    })
}

/// `%XX` decoded; `None` for an invalid escape or no UTF-8.
fn percent_decode(s: &str) -> Option<String> {
    let mut out = Vec::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hex = [bytes.next()?, bytes.next()?];
            let hex = std::str::from_utf8(&hex).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}

/// A refused request: status and reason.
pub(crate) type Refusal = (u16, &'static str);

/// What the guards see of a request.
#[derive(Debug, Default)]
pub(crate) struct Head<'a> {
    /// The values of `Host` (and the authority of an absolute target).
    pub(crate) hosts: Vec<&'a str>,
    pub(crate) origins: Vec<&'a str>,
    pub(crate) transfer_encoding: bool,
    pub(crate) content_length: Vec<&'a str>,
}

/// The names a client may use in `Host` besides IP literals.
#[derive(Debug, Clone)]
pub(crate) struct Hosts {
    names: Vec<String>,
    /// `https` or `http` (plain, dev only).
    scheme: &'static str,
}

impl Hosts {
    /// `localhost` and `names` (the container name, `OEC_REGISTRY_HOSTS`);
    /// `tls`: the scheme of the `Origin`.
    pub(crate) fn new(names: impl IntoIterator<Item = String>, tls: bool) -> Self {
        let mut all = vec!["localhost".to_owned()];
        for n in names {
            let n = n.trim().to_ascii_lowercase();
            if !n.is_empty() && !all.contains(&n) {
                all.push(n);
            }
        }
        Self {
            names: all,
            scheme: if tls { "https" } else { "http" },
        }
    }

    /// The names (lower case), `localhost` first.
    pub(crate) fn names(&self) -> &[String] {
        &self.names
    }

    /// A name of [`Self::names`] or an IP literal, with an optional port.
    pub(crate) fn allowed(&self, host: &str) -> bool {
        let name = if let Some(rest) = host.strip_prefix('[') {
            return match rest.split_once(']') {
                Some((ip, port)) if port.is_empty() || valid_port(port) => {
                    ip.parse::<std::net::Ipv6Addr>().is_ok()
                }
                _ => false,
            };
        } else {
            match host.rsplit_once(':') {
                Some((name, port)) if valid_port(&format!(":{port}")) => name,
                Some(_) => return false,
                None => host,
            }
        };
        name.parse::<std::net::Ipv4Addr>().is_ok()
            || self.names.iter().any(|n| n.eq_ignore_ascii_case(name))
    }

    /// The guards of ADR-0028 amendment C-083, in this order: `Host` (one,
    /// allowed: against DNS rebinding), `Origin` (same site: against
    /// cross-site requests), no `Transfer-Encoding`, `Content-Length` ≤
    /// [`MAX_BODY`]. The path, the method and the session are judged
    /// after (ADR-0035 §6).
    pub(crate) fn check(&self, h: &Head<'_>) -> Result<(), Refusal> {
        let [host] = h.hosts[..] else {
            return Err((400, "exactly one Host is required"));
        };
        if !self.allowed(host) {
            return Err((403, "Host is not a name of the registry or an IP address"));
        }
        match h.origins[..] {
            [] => {}
            [origin] if origin.eq_ignore_ascii_case(&format!("{}://{host}", self.scheme)) => {}
            _ => return Err((403, "cross-origin request")),
        }
        if h.transfer_encoding {
            return Err((501, "Transfer-Encoding is not supported"));
        }
        match h.content_length[..] {
            [] => {}
            [n] => match n.trim().parse::<u64>() {
                Ok(n) if n > MAX_BODY => return Err((413, "body too large")),
                Ok(_) => {}
                Err(_) => return Err((400, "invalid Content-Length")),
            },
            _ => return Err((400, "repeated Content-Length")),
        }
        Ok(())
    }
}

fn valid_port(p: &str) -> bool {
    p.strip_prefix(':')
        .is_some_and(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}

fn kind(k: Kind) -> &'static str {
    match k {
        Kind::Application => "application",
        Kind::Device => "device",
    }
}

fn availability(a: Availability) -> &'static str {
    match a {
        Availability::Online => "online",
        Availability::OfflineGraceful => "offlineGraceful",
        Availability::OfflineUngraceful => "offlineUngraceful",
    }
}

/// An MG payload as on the bus (`null` if it cannot be serialized).
macro_rules! to_json {
    ($v:expr) => {
        serde_json::to_value($v).unwrap_or(Value::Null)
    };
}

fn limits(l: Limits) -> Value {
    json!({
        "healthHistory": l.health_history,
        "eventTrail": l.event_trail,
        "violationTrail": l.violation_trail,
        "entries": crate::directory::ENTRIES,
        "valueMax": crate::directory::VALUE_MAX,
        "listEntries": crate::directory::LIST_ENTRIES,
    })
}

/// The summary of an entry (`/api/assets`, the stream).
pub(crate) fn summary(d: &Directory, e: &Entry) -> Value {
    let app = e.kind == Kind::Application;
    let observed = d.observed(&e.il).map_or(
        Value::Null,
        |o| json!({ "level": o.level, "missing": o.missing }),
    );
    let devices: Vec<&str> = if app {
        d.devices(&e.il).map(|x| x.il.as_str()).collect()
    } else {
        Vec::new()
    };
    let conformity = if app {
        d.conformity(&e.il).map_or_else(
            || json!({ "messages": 0, "violations": 0 }),
            |c| json!({ "messages": c.messages, "violations": c.violations }),
        )
    } else {
        Value::Null
    };
    json!({
        "il": e.il,
        "kind": kind(e.kind),
        "serviceType": e.service_type.as_str(),
        "publisher": e.publisher,
        "availability": availability(e.availability),
        "available": e.available(),
        "firstSeen": e.first_seen,
        "lastSeen": e.last_seen,
        "onlineSince": e.online_since,
        "mam": e.mam.as_ref().map_or(Value::Null, |m| to_json!(m)),
        "health": e.health.as_ref().map_or(Value::Null, |h| to_json!(h)),
        "observed": observed,
        "devices": devices,
        "conformity": conformity,
    })
}

fn want(w: Want) -> &'static str {
    w.resource().as_str()
}

fn violation(v: &Violation) -> Value {
    json!({ "at": v.at, "topic": v.topic, "reqs": v.reqs, "message": v.message })
}

/// One asset in detail (`/api/assets/{il}`); `None`: unknown.
pub(crate) fn asset(d: &Directory, il: &str) -> Option<Value> {
    let e = d.get(il)?;
    let mut v = summary(d, e);
    let answers: serde_json::Map<String, Value> = e
        .answers
        .iter()
        .map(|(w, a)| {
            let a = match a {
                Answer::Answered => json!({ "outcome": "answered" }),
                Answer::Timeout => json!({ "outcome": "timeout" }),
                Answer::Refused(why) => json!({ "outcome": "refused", "reason": why }),
            };
            (want(*w).to_owned(), a)
        })
        .collect();
    let history: Vec<Value> = e
        .health_history
        .iter()
        .map(|(at, h)| json!({ "at": at, "health": to_json!(h) }))
        .collect();
    let app = e.kind == Kind::Application;
    let detail = json!({
        "healthHistory": history,
        "profile": e.profile.as_ref().map(|p| p.iter().map(|s| s.as_str()).collect::<Vec<_>>()),
        "answers": answers,
        "publications": if app { to_json!(&e.publications) } else { Value::Null },
        "subscriptions": if app { to_json!(&e.subscriptions) } else { Value::Null },
        "violations": if app {
            Value::Array(d.conformity(il).map(|c| c.last.iter().map(violation).collect()).unwrap_or_default())
        } else {
            Value::Null
        },
    });
    if let (Value::Object(v), Value::Object(detail)) = (&mut v, detail) {
        v.extend(detail);
    }
    Some(v)
}

/// One Event of the trail.
pub(crate) fn event(r: &EventRecord) -> Value {
    json!({
        "seq": r.seq,
        "at": r.at,
        "publisher": r.publisher,
        "source": r.source,
        "filter": r.filter,
        "event": to_json!(&r.event),
    })
}

/// The directory as a whole without the assets.
fn directory(d: &Directory) -> Value {
    json!({
        "registry": d.me(),
        "version": env!("CARGO_PKG_VERSION"),
        "limits": limits(d.limits()),
        "ignored": d.ignored(),
    })
}

fn merged(mut base: Value, member: &str, value: Value) -> Value {
    if let Value::Object(m) = &mut base {
        m.insert(member.to_owned(), value);
    }
    base
}

/// `/api/assets` at the registry time `now` (Unix ms).
pub(crate) fn assets(d: &Directory, now: u64) -> Value {
    let all: Vec<Value> = d.entries().map(|e| summary(d, e)).collect();
    merged(
        merged(directory(d), "time", json!(now)),
        "assets",
        Value::Array(all),
    )
}

/// `/api/events`.
pub(crate) fn events(d: &Directory) -> Value {
    json!({
        "limit": d.limits().event_trail,
        "events": d.events().map(event).collect::<Vec<_>>(),
    })
}

/// `GET /api/data`: the last value of every `Data` DataSet (the data
/// logger), by Source, Filter and publisher.
pub(crate) fn data(d: &Directory) -> Value {
    let mut sets: Vec<_> = d.data_sets().collect();
    sets.sort_by(|a, b| {
        (&a.source, &a.filter, &a.publisher).cmp(&(&b.source, &b.filter, &b.publisher))
    });
    json!({
        "max": crate::directory::DATA_SETS,
        "dataSets": sets.into_iter().map(|r| json!({
            "seq": r.seq,
            "at": r.at,
            "publisher": r.publisher,
            "source": r.source,
            "filter": r.filter,
            "dataSetWriterId": r.data_set_writer_id,
            "payload": r.payload,
        })).collect::<Vec<_>>(),
    })
}

/// What one event stream has sent: the messages for the changes since.
/// It keeps a digest of each message, not the message (C-113 RR-3: up to
/// [`crate::directory::ENTRIES`] summaries per stream).
#[derive(Debug, Default)]
pub(crate) struct Stream {
    assets: BTreeMap<String, u64>,
    directory: u64,
    last_event: u64,
    keys: RandomState,
}

impl Stream {
    /// The first message: `{"type":"snapshot", …/api/assets…, "events"}`.
    pub(crate) fn snapshot(&mut self, d: &Directory, now: u64) -> String {
        self.assets = d
            .entries()
            .map(|e| (e.il.clone(), self.keys.hash_one(summary(d, e).to_string())))
            .collect();
        self.directory = self.keys.hash_one(directory(d).to_string());
        self.last_event = d.events().last().map_or(0, |r| r.seq);
        let v = merged(assets(d, now), "events", events(d)["events"].take());
        merged(v, "type", json!("snapshot")).to_string()
    }

    /// The messages for what changed since the last call: `directory`
    /// (limits, ignored), `asset` (a new or changed summary) and `event`
    /// (each new Event of the trail).
    pub(crate) fn changes(&mut self, d: &Directory) -> Vec<String> {
        let mut out = Vec::new();
        let dir = directory(d);
        let digest = self.keys.hash_one(dir.to_string());
        if digest != self.directory {
            out.push(merged(dir, "type", json!("directory")).to_string());
            self.directory = digest;
        }
        // entries the directory gave up (C-113 RR-3) are forgotten
        self.assets.retain(|il, _| d.get(il).is_some());
        for e in d.entries() {
            let s = summary(d, e);
            let digest = self.keys.hash_one(s.to_string());
            if self.assets.get(&e.il) != Some(&digest) {
                out.push(json!({ "type": "asset", "asset": s }).to_string());
                self.assets.insert(e.il.clone(), digest);
            }
        }
        let last = self.last_event;
        for r in d.events().filter(|r| r.seq > last) {
            out.push(json!({ "type": "event", "event": event(r) }).to_string());
            self.last_event = r.seq;
        }
        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::directory::Origin;
    use oec::ServiceType;
    use oec::consumer::{Health, HealthState};

    pub(crate) const ME: &str = "oi4.org/OEC,20Registry/OEC-REGISTRY/reg-1";
    pub(crate) const APP: &str = "vendor.com/Gateway/GW-1/SN-1";
    pub(crate) const PUMP: &str = "vendor.com/Pump/P-1/0815";

    fn at<'a>(app: &'a str, source: &'a str, reply: bool, now: u64) -> Origin<'a> {
        Origin {
            service_type: ServiceType::Aggregation,
            app,
            source,
            reply,
            now,
        }
    }

    fn mam(piu: &str) -> oec::identity::Mam {
        serde_json::from_value(json!({
            "Manufacturer": {"Locale": "en-US", "Text": "Vendor"},
            "ManufacturerUri": "vendor.com",
            "Model": {"Locale": "en-US", "Text": "Gateway"},
            "ProductCode": "GW-1",
            "HardwareRevision": "",
            "SoftwareRevision": "1.0.0",
            "DeviceRevision": "",
            "DeviceManual": "",
            "DeviceClass": "Oi4.Aggregation",
            "SerialNumber": "SN-1",
            "ProductInstanceUri": piu,
            "RevisionCounter": 0
        }))
        .unwrap()
    }

    fn health(score: u8) -> Health {
        Health {
            health: HealthState::Normal,
            health_score: Some(score),
            details: None,
        }
    }

    /// A directory with an application, its device, an Event, lists, an
    /// answer of each kind and a violation (the fixture of the view
    /// tests, also validated against the OpenAPI schemas).
    pub(crate) fn fixture() -> Directory {
        use crate::directory::{Fetch, Lists};
        let mut d = Directory::new(ME);
        d.mam(&at(APP, APP, false, 1), mam(APP));
        d.health(&at(APP, APP, false, 1), health(100));
        d.health(&at(APP, APP, false, 2), health(90));
        d.mam(&at(APP, PUMP, false, 2), mam(PUMP));
        d.health(&at(APP, PUMP, false, 2), health(80));
        d.profile(
            &at(APP, APP, true, 3),
            vec![
                oec_core::topic::Subject::Resource(oec::consumer::Resource::Mam),
                oec_core::topic::Subject::Service(oec_core::topic::Service::NewDataSetWriterId),
            ],
        );
        d.event(
            &at(APP, PUMP, false, 4),
            Some("Generic/Info".to_owned()),
            serde_json::from_value(json!({
                "Number": 0, "Category": "CAT_GENERIC_99", "Description": "d",
                "Details": {"x": 1}
            }))
            .unwrap(),
        );
        d.data(
            &at(APP, PUMP, false, 4),
            Some("Pressure".to_owned()),
            12,
            json!({"Value": 1.5}),
        );
        d.data(
            &at(APP, APP, true, 4),
            None,
            13,
            json!({"Blob": "x".repeat(crate::directory::DATA_MAX)}),
        );
        let fetch = |want| Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want,
        };
        d.asked(
            &fetch(Want::PublicationList),
            Answer::Answered,
            Lists::Publications(vec![
                serde_json::from_value(json!({
                    "Resource": "MAM", "Source": PUMP, "DataSetWriterId": 12,
                    "Mode": "APPLICATION_SOURCE_5"
                }))
                .unwrap(),
            ]),
        );
        d.asked(
            &fetch(Want::SubscriptionList),
            Answer::Refused("BadNotSupported".to_owned()),
            Lists::None,
        );
        d.asked(&fetch(Want::Health), Answer::Timeout, Lists::None);
        d.checked(APP, None);
        d.checked(
            APP,
            Some(Violation {
                at: 5,
                topic: "Oi4v2/Aggregation/vendor.com/Gateway/GW-1/SN-1/Pub/Health".to_owned(),
                reqs: vec!["REQ-RES-HEALTH-001".to_owned()],
                message: "bad".to_owned(),
            }),
        );
        d
    }

    /// A new Health of the device and a new Event at time 8.
    pub(crate) fn change(d: &mut Directory) {
        d.health(&at(APP, PUMP, false, 8), health(70));
        d.event(
            &at(APP, APP, false, 8),
            None,
            serde_json::from_value(json!({"Number": 1, "Category": "CAT_STATUS_1"})).unwrap(),
        );
    }

    #[test]
    fn routes() {
        let Some(Route::Ui(index)) = route("/", true) else {
            panic!("/ is not the Web UI");
        };
        assert_eq!(index.path, "/index.html");
        assert_eq!(index.content_type, "text/html; charset=utf-8");
        assert_eq!(route("/index.html", true), Some(Route::Ui(index)));
        assert_eq!(route("/", false), None);
        assert_eq!(route("/index.html", false), None);
        for f in UI_FILES {
            assert_eq!(route(f.path, true), Some(Route::Ui(f)), "{}", f.path);
            assert_eq!(route(f.path, false), None, "{}", f.path);
        }
        for none in [
            "/x.js",
            "/assets",
            "/assets/",
            "/index.htm",
            "//index.html",
            "/../index.html",
        ] {
            assert_eq!(route(none, true), None, "{none}");
        }
        assert_eq!(route("/api/assets", false), Some(Route::Assets));
        assert_eq!(route("/api/assets/", false), None);
        assert_eq!(
            route("/api/assets/x/", true),
            Some(Route::Asset("x/".into()))
        );
        // percent-encoded as one segment, or plain
        let enc = "oi4.org%2FOEC%2C20Registry%2FOEC-REGISTRY%2Freg-1";
        assert_eq!(
            route(&format!("/api/assets/{enc}"), false),
            Some(Route::Asset(ME.into()))
        );
        assert_eq!(
            route(&format!("/api/assets/{ME}"), false),
            Some(Route::Asset(ME.into()))
        );
        assert_eq!(route("/api/assets/%zz", false), None);
        assert_eq!(route("/api/assets/%ff", false), None);
        assert_eq!(route("/api/assets/%2", false), None);
        assert_eq!(route("/api/stream", false), Some(Route::Stream));
        assert_eq!(route("/api/stream/", false), None);
        assert_eq!(route("/index.html", false), None);
        assert_eq!(route("/api", true), None);
        for p in Route::PATHS {
            let r = route(&p.replace("{il}", "x"), false).unwrap();
            assert_eq!(r.template(), Some(p));
        }
    }

    /// The files of `dir` below `prefix`: (`/`-path, bytes).
    fn walk(dir: &std::path::Path, prefix: &str, out: &mut Vec<(String, Vec<u8>)>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let e = e.unwrap();
            let name = e.file_name().into_string().unwrap();
            if name == ".DS_Store" {
                continue;
            }
            let path = format!("{prefix}/{name}");
            if e.file_type().unwrap().is_dir() {
                walk(&e.path(), &path, out);
            } else {
                out.push((path, std::fs::read(e.path()).unwrap()));
            }
        }
    }

    /// The generated table embeds exactly the files of `ui/dist/`, sorted,
    /// with the content type of their extension (ADR-0029 §9).
    #[test]
    fn ui_table_is_dist() {
        let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("ui/dist");
        let mut files = Vec::new();
        walk(&dist, "", &mut files);
        files.sort();
        let table: Vec<_> = UI_FILES
            .iter()
            .map(|f| (f.path.to_owned(), f.bytes.to_vec()))
            .collect();
        assert_eq!(
            table.iter().map(|f| &f.0).collect::<Vec<_>>(),
            files.iter().map(|f| &f.0).collect::<Vec<_>>(),
            "src/ui_assets.rs is not ui/dist/: run ui/build.sh"
        );
        assert!(
            table == files,
            "src/ui_assets.rs: other bytes than ui/dist/"
        );
        for f in UI_FILES {
            let ext = f.path.rsplit_once('.').map_or("", |(_, e)| e);
            let want = match ext {
                "html" => "text/html; charset=utf-8",
                "js" => "text/javascript; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "svg" => "image/svg+xml",
                _ => panic!("{}: no content type", f.path),
            };
            assert_eq!(f.content_type, want, "{}", f.path);
        }
        let index = std::str::from_utf8(ui_file("/").unwrap().bytes).unwrap();
        assert!(index.contains(r#"<div id="root">"#));
        assert!(!index.contains("<style") && !index.contains(" style="));
    }

    fn head<'a>(_method: &'a str, host: &'a str) -> Head<'a> {
        Head {
            hosts: vec![host],
            ..Head::default()
        }
    }

    #[test]
    fn guards() {
        let h = Hosts::new(["reg-1".to_owned(), " Registry.Example ".to_owned()], true);
        assert_eq!(h.names(), ["localhost", "reg-1", "registry.example"]);
        for ok in [
            "localhost",
            "LOCALHOST:5798",
            "reg-1",
            "reg-1:5799",
            "registry.example",
            "127.0.0.1:5798",
            "10.1.2.3",
            "[::1]",
            "[::1]:5798",
        ] {
            assert_eq!(h.check(&head("GET", ok)), Ok(()), "{ok}");
        }
        for bad in [
            "evil.example",
            "localhost.example:80",
            "reg-1:x",
            "reg-1:123456",
            "[::1",
            "[::1]x",
            "[nope]",
            "",
        ] {
            assert_eq!(
                h.check(&head("GET", bad)).map_err(|r| r.0),
                Err(403),
                "{bad}"
            );
        }
        let mut no_host = head("GET", "x");
        no_host.hosts.clear();
        assert_eq!(h.check(&no_host).map_err(|r| r.0), Err(400));
        let mut two = head("GET", "localhost");
        two.hosts.push("localhost");
        assert_eq!(h.check(&two).map_err(|r| r.0), Err(400));

        let with = |origin| Head {
            origins: vec![origin],
            ..head("GET", "reg-1:5798")
        };
        assert_eq!(h.check(&with("https://reg-1:5798")), Ok(()));
        assert_eq!(
            h.check(&with("http://reg-1:5798")).map_err(|r| r.0),
            Err(403)
        );
        assert_eq!(
            h.check(&with("https://evil.example")).map_err(|r| r.0),
            Err(403)
        );
        let plain = Hosts::new([], false);
        let o = Head {
            origins: vec!["http://localhost:1"],
            ..head("GET", "localhost:1")
        };
        assert_eq!(plain.check(&o), Ok(()));

        let te = Head {
            transfer_encoding: true,
            ..head("POST", "localhost")
        };
        assert_eq!(h.check(&te).map_err(|r| r.0), Err(501));
        let big = Head {
            content_length: vec!["65537"],
            ..head("POST", "localhost")
        };
        assert_eq!(h.check(&big).map_err(|r| r.0), Err(413));
        let bad = Head {
            content_length: vec!["x"],
            ..head("GET", "localhost")
        };
        assert_eq!(h.check(&bad).map_err(|r| r.0), Err(400));
        let small = Head {
            content_length: vec!["2"],
            ..head("POST", "localhost")
        };
        assert_eq!(h.check(&small), Ok(()));
    }

    /// The methods and the access of the routes (ADR-0035 §6).
    #[test]
    fn methods_and_access() {
        let r = |p| route(p, true).unwrap();
        for (path, allow, access) in [
            ("/", "GET", Access::Public),
            ("/api/openapi.json", "GET", Access::Public),
            ("/api/asyncapi.json", "GET", Access::Public),
            ("/api/login", "POST", Access::Public),
            ("/api/logout", "POST", Access::Public),
            ("/api/session", "GET", Access::Session),
            ("/api/password", "POST", Access::Session),
            ("/api/assets", "GET", Access::Read),
            ("/api/assets/x", "GET", Access::Read),
            ("/api/events", "GET", Access::Read),
            ("/api/data", "GET", Access::Read),
            ("/api/stream", "GET", Access::Read),
            ("/api/users", "GET, POST", Access::Admin),
            ("/api/users/jane", "PUT, DELETE", Access::Admin),
        ] {
            assert_eq!(
                (r(path).allow(), r(path).access()),
                (allow, access),
                "{path}"
            );
            assert_eq!(r(path).methods().join(", "), allow, "{path}");
        }
        assert_eq!(
            r("/api/users/jane%40acme"),
            Route::User("jane@acme".to_owned())
        );
        for nope in [
            "/api/users/",
            "/api/users/a%2Fb",
            "/api/users/a/b",
            "/api/users/%zz",
        ] {
            assert_eq!(route(nope, true), None, "{nope}");
        }
    }

    #[test]
    fn views() {
        let d = fixture();
        let all = assets(&d, 9);
        assert_eq!(all["registry"], ME);
        assert_eq!(all["time"], 9);
        assert_eq!(all["limits"]["eventTrail"], 200);
        // C-113 RR-3: the fixed bounds of the directory
        assert_eq!(all["limits"]["entries"], crate::directory::ENTRIES);
        assert_eq!(all["limits"]["valueMax"], crate::directory::VALUE_MAX);
        assert_eq!(all["limits"]["listEntries"], crate::directory::LIST_ENTRIES);
        let list = all["assets"].as_array().unwrap();
        assert_eq!(list.len(), 2);
        let app = &list[0];
        assert_eq!(app["il"], APP);
        assert_eq!(app["kind"], "application");
        assert_eq!(app["serviceType"], "Aggregation");
        assert_eq!(app["availability"], "online");
        assert_eq!(app["available"], true);
        assert_eq!(app["health"]["HealthScore"], 90);
        assert_eq!(app["mam"]["ProductInstanceUri"], APP);
        assert_eq!(app["devices"], json!([PUMP]));
        assert_eq!(app["conformity"], json!({"messages": 2, "violations": 1}));
        assert_eq!(app["observed"]["level"], 1);
        let pump = &list[1];
        assert_eq!(pump["kind"], "device");
        assert_eq!(pump["publisher"], APP);
        assert_eq!(pump["conformity"], Value::Null);

        let one = asset(&d, APP).unwrap();
        assert_eq!(one["healthHistory"].as_array().unwrap().len(), 2);
        assert_eq!(one["profile"], json!(["MAM", "NewDataSetWriterId"]));
        assert_eq!(
            one["answers"],
            json!({
                "Health": {"outcome": "timeout"},
                "Profile": {"outcome": "answered"},
                "PublicationList": {"outcome": "answered"},
                "SubscriptionList": {"outcome": "refused", "reason": "BadNotSupported"},
            })
        );
        assert_eq!(one["publications"][0]["DataSetWriterId"], 12);
        assert_eq!(one["subscriptions"], json!([]));
        assert_eq!(one["violations"][0]["reqs"], json!(["REQ-RES-HEALTH-001"]));
        let dev = asset(&d, PUMP).unwrap();
        assert_eq!(dev["publications"], Value::Null);
        assert_eq!(dev["violations"], Value::Null);
        assert!(asset(&d, "nope").is_none());

        let ev = events(&d);
        assert_eq!(ev["events"][0]["seq"], 1);
        assert_eq!(ev["events"][0]["source"], PUMP);
        assert_eq!(ev["events"][0]["filter"], "Generic/Info");
        assert_eq!(ev["events"][0]["event"]["Number"], 0);

        let data = data(&d);
        assert_eq!(data["max"], 1000);
        assert_eq!(
            data["dataSets"],
            json!([
                {"seq": 2, "at": 4, "publisher": APP, "source": APP, "filter": null,
                 "dataSetWriterId": 13, "payload": null},
                {"seq": 1, "at": 4, "publisher": APP, "source": PUMP, "filter": "Pressure",
                 "dataSetWriterId": 12, "payload": {"Value": 1.5}},
            ])
        );
    }

    #[test]
    fn stream_changes() {
        let mut d = fixture();
        let mut s = Stream::default();
        let first: Value = serde_json::from_str(&s.snapshot(&d, 7)).unwrap();
        assert_eq!(first["type"], "snapshot");
        assert_eq!(first["assets"].as_array().unwrap().len(), 2);
        assert_eq!(first["events"].as_array().unwrap().len(), 1);
        assert!(s.changes(&d).is_empty());

        change(&mut d);
        let msgs: Vec<Value> = s
            .changes(&d)
            .iter()
            .map(|m| serde_json::from_str(m).unwrap())
            .collect();
        let types: Vec<&str> = msgs.iter().map(|m| m["type"].as_str().unwrap()).collect();
        assert_eq!(types, ["asset", "event"]);
        assert_eq!(msgs[0]["asset"]["il"], PUMP);
        assert_eq!(msgs[1]["event"]["seq"], 2);
        assert!(s.changes(&d).is_empty());

        d.set_limits(Limits {
            event_trail: 1,
            ..Limits::default()
        });
        let msgs = s.changes(&d);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].contains(r#""type":"directory""#), "{}", msgs[0]);
    }

    /// C-113 RR-3: a stream keeps a digest per asset of the directory,
    /// and forgets the assets the directory gave up.
    #[test]
    fn stream_is_bounded() {
        let mut d = Directory::new(ME);
        let il = |i: usize| format!("vendor.com/App/A-1/{i}");
        let normal = Health {
            health: HealthState::Normal,
            health_score: Some(100),
            details: None,
        };
        for i in 0..crate::directory::ENTRIES {
            d.health(&at(&il(i), &il(i), false, 1), normal.clone());
        }
        let mut s = Stream::default();
        s.snapshot(&d, 1);
        let close = Health {
            health_score: Some(0),
            ..normal.clone()
        };
        d.health(&at(&il(0), &il(0), false, 2), close);
        let extra = il(crate::directory::ENTRIES);
        d.health(&at(&extra, &extra, false, 3), normal);
        assert!(d.get(&il(0)).is_none());
        assert_eq!(s.changes(&d).len(), 1, "the new asset");
        assert_eq!(s.assets.len(), crate::directory::ENTRIES);
        assert!(!s.assets.contains_key(&il(0)));
    }
}
