//! The bus side of the registry (ADR-0029 §3 … §6): the subscriptions to
//! `Pub/MAM`, `Pub/Health`, `Pub/Profile`, `Pub/Event`,
//! `Pub/PublicationList`, `Pub/SubscriptionList` and `Pub/Data` (the data
//! logger, last value only) of every application,
//! the [`Directory`], the listing of the available assets in the Registry
//! services (MG A1, REQ-REG-002, through the SDK's listed assets), the
//! `Get`s for what is missing and the conformity view: every message is
//! checked against the strict schema flavor of the SDK core (the same as
//! D7's), informative and independent of D7.
//!
//! Read-only (ADR-0008): towards other participants the registry only
//! subscribes and sends `Get`; it never sends `Set`, `Del` or `Call`
//! (asserted by the test `read_only`).

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use oec::Error;
use oec::app::AppHandle;
use oec::config::{ConfigDef, ConfigHandle, ConfigObject};
use oec::consumer::{
    Consumer, GetOptions, Payload, RawPublication, Received, Resource, Subscription, Target,
};
use oec::identity::IdentificationLink;
use oec_core::schema::{Flavor, Validator};
use oec_core::topic::Topic;

use crate::directory::{Answer, Directory, Effect, Fetch, Limits, Lists, Origin, Violation};

/// The resources the registry collects from every application; MAM and
/// Health it offers in the Registry services (MG A1); of Data it keeps the
/// last value (the data logger, ADR-0029 amendment 2026-11-28).
pub(crate) const COLLECTED: [Resource; 7] = [
    Resource::Mam,
    Resource::Health,
    Resource::Profile,
    Resource::Event,
    Resource::PublicationList,
    Resource::SubscriptionList,
    Resource::Data,
];

/// The time a `Get` waits, so a Health that follows a Birth at once makes
/// it unnecessary.
const FETCH_DELAY: Duration = Duration::from_millis(500);
/// The applications asked at the same time; the others wait.
const MAX_PROBES: usize = 16;
/// The longest violation message kept, in characters.
const MESSAGE_MAX: usize = 512;

/// The Config of the registry (ADR-0029 §3): its context name (the Filter
/// of `Config/<AppId>/<Filter>`) and group.
pub(crate) const CONFIG: &str = "registry";
const GROUP: &str = "directory";

/// A setting of the group [`GROUP`] (Type Number, whole numbers).
struct Setting {
    name: &'static str,
    default: u32,
    min: u32,
    max: u32,
    unit: Option<&'static str>,
    label: &'static str,
}

/// The settings of the group [`GROUP`].
const SETTINGS: [Setting; 5] = [
    Setting {
        name: "GetInterval",
        default: 10,
        min: 1,
        max: 3600,
        unit: Some("s"),
        label: "Least time between two Get of a resource of an application",
    },
    Setting {
        name: "GetTimeout",
        default: 5,
        min: 1,
        max: 60,
        unit: Some("s"),
        label: "Time an answer may take",
    },
    Setting {
        name: "HealthHistory",
        default: 20,
        min: 0,
        max: 1000,
        unit: None,
        label: "Health changes kept per asset",
    },
    Setting {
        name: "EventTrail",
        default: 200,
        min: 0,
        max: 10000,
        unit: None,
        label: "Events kept of all participants",
    },
    Setting {
        name: "ViolationTrail",
        default: 10,
        min: 0,
        max: 1000,
        unit: None,
        label: "Schema violations kept per participant",
    },
];

/// The definition of the registry's Config.
pub(crate) fn config() -> ConfigDef {
    ConfigDef::new(CONFIG).label("OEC Registry").group(
        GROUP,
        "Directory",
        SETTINGS.iter().map(|s| {
            let o = ConfigObject::number(s.name, f64::from(s.default))
                .label(s.label)
                .min(f64::from(s.min))
                .max(f64::from(s.max));
            match s.unit {
                Some(u) => o.unit(u),
                None => o,
            }
        }),
    )
}

/// The current settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Settings {
    interval: Duration,
    timeout: Duration,
    limits: Limits,
}

impl Settings {
    fn read(config: &ConfigHandle) -> Self {
        let values = config.values();
        let get = |name: &str| -> u32 {
            let s = SETTINGS
                .iter()
                .find(|s| s.name == name)
                .expect("a known setting");
            whole(values.number(GROUP, name), s.default).clamp(s.min, s.max)
        };
        Self {
            interval: Duration::from_secs(get("GetInterval").into()),
            timeout: Duration::from_secs(get("GetTimeout").into()),
            limits: Limits {
                health_history: get("HealthHistory") as usize,
                event_trail: get("EventTrail") as usize,
                violation_trail: get("ViolationTrail") as usize,
            },
        }
    }
}

/// A Config number as a whole number; `default` if unset.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to the range of u32 first"
)]
fn whole(value: Option<f64>, default: u32) -> u32 {
    value
        .filter(|v| v.is_finite())
        .map_or(default, |v| v.clamp(0.0, f64::from(u32::MAX)) as u32)
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// The bus side: see the [module](self).
pub(crate) struct Bus {
    app: AppHandle,
    consumer: Consumer,
    config: ConfigHandle,
    validator: Option<Validator>,
    dir: Arc<Mutex<Directory>>,
    jobs: Mutex<Sender<Vec<Effect>>>,
    /// The applications being asked (one thread each).
    probing: Mutex<BTreeSet<String>>,
    subscriptions: Mutex<Vec<Subscription>>,
}

impl Bus {
    /// Starts the bus side of `app` with the registry's Config `config`:
    /// the subscriptions and the worker thread for the listing and the
    /// `Get`s.
    ///
    /// # Errors
    ///
    /// The SDK refuses a subscription, or the thread can not be started.
    pub(crate) fn start(app: AppHandle, config: ConfigHandle) -> Result<Arc<Self>, String> {
        let (jobs, queue) = mpsc::channel();
        let validator = Validator::new()
            .inspect_err(|e| log::warn!("registry: no conformity view: {e}"))
            .ok();
        let mut dir = Directory::new(app.identification_link().as_str());
        let settings = Settings::read(&config);
        dir.set_limits(settings.limits);
        let bus = Arc::new(Self {
            consumer: app.consumer(),
            dir: Arc::new(Mutex::new(dir)),
            app,
            config,
            validator,
            jobs: Mutex::new(jobs),
            probing: Mutex::new(BTreeSet::new()),
            subscriptions: Mutex::new(Vec::new()),
        });
        for resource in COLLECTED {
            let me = Arc::downgrade(&bus);
            let sub = bus
                .consumer
                .subscribe_raw(resource, &Target::any(), move |p| {
                    if let Some(bus) = Weak::upgrade(&me) {
                        bus.publication(p);
                    }
                })
                .map_err(|e| e.to_string())?;
            lock(&bus.subscriptions).push(sub);
        }
        let worker = Arc::downgrade(&bus);
        std::thread::Builder::new()
            .name("oec-registry-bus".to_owned())
            .spawn(move || work(&worker, &queue))
            .map_err(|e| e.to_string())?;
        Ok(bus)
    }

    /// The directory, shared with the HTTP side ([`crate::http`]), which
    /// only reads it.
    pub(crate) fn directory(&self) -> Arc<Mutex<Directory>> {
        Arc::clone(&self.dir)
    }

    /// A publication of any application on one of the [`COLLECTED`]
    /// resources, including the answers to `Get`s.
    fn publication(&self, p: &RawPublication) {
        self.check(p);
        for r in p.items() {
            self.received(r);
        }
    }

    /// The conformity view (ADR-0029 §6): the topic, the JSON and the
    /// strict schema flavor, attributed as by D7 (REQ-TOP-003 for a topic
    /// out of the grammar, REQ-CMP-005 for no JSON); a payload the schema
    /// accepts but the SDK can not decode counts without requirement.
    fn check(&self, p: &RawPublication) {
        let violation = |reqs: Vec<String>, message: String| Violation {
            at: unix_ms(),
            topic: p.topic().to_owned(),
            reqs,
            message: message.chars().take(MESSAGE_MAX).collect(),
        };
        let (app, outcome) = match Topic::parse(p.topic()) {
            Err(e) => (
                p.topic().split('/').nth(2).unwrap_or_default().to_owned(),
                Some(violation(
                    vec!["REQ-TOP-003".to_owned()],
                    format!("the topic does not follow the grammar: {e}"),
                )),
            ),
            Ok(topic) => {
                let outcome = match serde_json::from_slice::<serde_json::Value>(p.payload()) {
                    Err(e) => Some(violation(
                        vec!["REQ-CMP-005".to_owned()],
                        format!("the payload is no JSON: {e}"),
                    )),
                    Ok(json) => match self
                        .validator
                        .as_ref()
                        .map(|v| v.validate_topic(&topic, Flavor::Strict, &json))
                    {
                        Some(Err(e)) => Some(violation(e.reqs.clone(), e.to_string())),
                        _ => p.error().map(|e| violation(Vec::new(), e.to_owned())),
                    },
                };
                (topic.app_id().as_str().to_owned(), outcome)
            }
        };
        lock(&self.dir).checked(&app, outcome);
    }

    /// One DataSetMessage of a collected resource.
    fn received(&self, r: &Received) {
        let app = r.app();
        let source = r.data_set_writer_name();
        let o = Origin {
            service_type: r.service_type(),
            app: app.as_str(),
            source: source.as_str(),
            reply: r.reply_to().is_some(),
            now: unix_ms(),
        };
        let effects = {
            let mut dir = lock(&self.dir);
            match r.payload() {
                Payload::Mam(m) => dir.mam(&o, m.clone()),
                Payload::Health(h) => dir.health(&o, h.clone()),
                Payload::Profile(p) => {
                    dir.profile(&o, p.resources.clone());
                    return;
                }
                Payload::Event(e) => {
                    dir.event(&o, r.filter(), e.clone());
                    return;
                }
                Payload::PublicationList(e) => {
                    dir.publications(&o, vec![e.clone()]);
                    return;
                }
                Payload::SubscriptionList(e) => {
                    dir.subscriptions(&o, vec![e.clone()]);
                    return;
                }
                Payload::Data(d) => {
                    let filter = r.filter().or_else(|| r.writer_group_name());
                    let value = serde_json::Value::Object(d.0.clone());
                    dir.data(&o, filter, r.data_set_writer_id(), value);
                    return;
                }
                _ => return,
            }
        };
        if !effects.is_empty() {
            let _ = lock(&self.jobs).send(effects);
        }
    }

    fn apply(&self, effect: Effect, due: &mut VecDeque<(Instant, Fetch)>) {
        match effect {
            Effect::List { il, mam, health } => {
                let listed = IdentificationLink::parse(&il)
                    .and_then(|link| self.app.list_asset(&link, *mam, health));
                if let Err(e) = listed {
                    log::warn!("registry: {il} not listed: {e}");
                }
                self.summary();
            }
            Effect::Unlist(il) => {
                if let Ok(link) = IdentificationLink::parse(&il) {
                    self.app.unlist_asset(&link);
                }
                self.summary();
            }
            Effect::Fetch(f) => {
                if !due.iter().any(|(_, d)| d == &f) {
                    due.push_back((Instant::now() + FETCH_DELAY, f));
                }
            }
        }
    }

    /// Logs the size of the directory after a change of the listing.
    fn summary(&self) {
        let dir = lock(&self.dir);
        let (known, available) = dir
            .entries()
            .fold((0, 0), |(k, a), e| (k + 1, a + usize::from(e.available())));
        log::info!(
            "registry: {available} of {known} assets available, {} messages ignored",
            dir.ignored()
        );
    }

    /// Asks one application in a thread of its own: the `Get`s of `batch`
    /// in order, each if still needed. `false` if the application is
    /// already being asked or too many are.
    fn probe(self: &Arc<Self>, app: &str, batch: Vec<Fetch>, timeout: Duration) -> bool {
        {
            let mut probing = lock(&self.probing);
            if probing.contains(app) || probing.len() >= MAX_PROBES {
                return false;
            }
            probing.insert(app.to_owned());
        }
        let bus = Arc::clone(self);
        let name = app.to_owned();
        let spawned = std::thread::Builder::new()
            .name("oec-registry-get".to_owned())
            .spawn(move || {
                for f in &batch {
                    if !bus.fetch(f, timeout) {
                        break;
                    }
                }
                lock(&bus.probing).remove(&name);
            });
        if let Err(e) = spawned {
            log::warn!("registry: no thread for the Get: {e}");
            lock(&self.probing).remove(app);
        }
        true
    }

    /// Sends the `Get` of `f` if it is still needed and records the
    /// outcome; the items of the answers arrive by the subscriptions.
    /// `false` if an application does not answer `Get MAM` or `Get Health`:
    /// it is not asked for more.
    fn fetch(&self, f: &Fetch, timeout: Duration) -> bool {
        if !lock(&self.dir).missing(f) {
            return true;
        }
        let Ok(app) = IdentificationLink::parse(&f.app) else {
            return false;
        };
        let resource = f.want.resource();
        let options = GetOptions::new().timeout(timeout);
        let (answer, lists) =
            match self
                .consumer
                .get_blocking(resource, &Target::app(f.service_type, app), &options)
            {
                Ok(answers) => (Answer::Answered, lists(resource, &answers)),
                Err(Error::Timeout) => (Answer::Timeout, Lists::None),
                Err(e) => (Answer::Refused(e.to_string()), Lists::None),
            };
        log::debug!("registry: Get {resource:?} of {}: {answer:?}", f.app);
        let go_on =
            answer != Answer::Timeout || !matches!(resource, Resource::Mam | Resource::Health);
        lock(&self.dir).asked(f, answer, lists);
        go_on
    }
}

/// The complete lists of the answers to a `Get` of `resource`.
fn lists(resource: Resource, answers: &[Received]) -> Lists {
    match resource {
        Resource::PublicationList => Lists::Publications(
            answers
                .iter()
                .filter_map(|r| match r.payload() {
                    Payload::PublicationList(e) => Some(e.clone()),
                    _ => None,
                })
                .collect(),
        ),
        Resource::SubscriptionList => Lists::Subscriptions(
            answers
                .iter()
                .filter_map(|r| match r.payload() {
                    Payload::SubscriptionList(e) => Some(e.clone()),
                    _ => None,
                })
                .collect(),
        ),
        _ => Lists::None,
    }
}

/// The worker: applies the effects in order, reads the settings and starts
/// the `Get`s, delayed by [`FETCH_DELAY`], at most once per `GetInterval`
/// per application and resource, the `Get`s of one application in one
/// thread.
fn work(bus: &Weak<Bus>, queue: &Receiver<Vec<Effect>>) {
    let mut due: VecDeque<(Instant, Fetch)> = VecDeque::new();
    let mut sent: BTreeMap<Fetch, Instant> = BTreeMap::new();
    let mut settings: Option<Settings> = None;
    loop {
        let wait = due
            .iter()
            .map(|(at, _)| at.saturating_duration_since(Instant::now()))
            .min()
            .map_or(Duration::from_secs(1), |d| d.min(Duration::from_secs(1)));
        let received = queue.recv_timeout(wait);
        let Some(bus) = bus.upgrade() else {
            return;
        };
        match received {
            Ok(effects) => {
                for effect in effects {
                    bus.apply(effect, &mut due);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let now_settings = Settings::read(&bus.config);
        if settings != Some(now_settings) {
            lock(&bus.dir).set_limits(now_settings.limits);
            settings = Some(now_settings);
        }
        let now = Instant::now();
        let mut batches: BTreeMap<String, Vec<Fetch>> = BTreeMap::new();
        let mut later = VecDeque::new();
        while let Some((at, f)) = due.pop_front() {
            if at > now {
                later.push_back((at, f));
            } else if sent
                .get(&f)
                .is_none_or(|at| now.duration_since(*at) >= now_settings.interval)
            {
                batches.entry(f.app.clone()).or_default().push(f);
            }
        }
        due = later;
        for (app, mut batch) in batches {
            batch.sort_by_key(|f| f.want);
            if bus.probe(&app, batch.clone(), now_settings.timeout) {
                for f in batch {
                    sent.insert(f, now);
                }
            } else {
                let retry = now + Duration::from_secs(1);
                due.extend(batch.into_iter().map(|f| (retry, f)));
            }
        }
        sent.retain(|_, at| now.duration_since(*at) < now_settings.interval);
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// The source without its `#[cfg(test)] mod tests { … }` blocks.
    fn without_tests(text: &str) -> String {
        let mut out = String::new();
        let mut rest = text;
        while let Some(i) = rest.find("#[cfg(test)]") {
            out.push_str(&rest[..i]);
            let after = &rest[i + "#[cfg(test)]".len()..];
            let trimmed = after.trim_start();
            if !trimmed.starts_with("mod tests {") {
                // e.g. `#[cfg(test)] mod api_tests;`: a file of its own
                out.push_str("#[cfg(test)]");
                rest = after;
                continue;
            }
            let body = &trimmed["mod tests ".len()..];
            let mut depth = 0usize;
            let mut end = body.len();
            for (j, c) in body.char_indices() {
                match c {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = j + 1;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            rest = &body[end..];
        }
        out.push_str(rest);
        out
    }

    fn sources(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                sources(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push(path);
            }
        }
    }

    /// ADR-0008, ADR-0029 §4: the registry never changes another
    /// participant. Of the SDK consumer it may use `subscribe`,
    /// `subscribe_raw`, `on_presence`, `apps` and `get` only: no `set`,
    /// `del` or `new_data_set_writer_id` (a `Call`) in its sources, all
    /// files below `src`, whitespace ignored, test modules excluded. The
    /// sources use no other method of these names either. The HTTP side
    /// (C-088) names no other HTTP method, reads no request body, and the
    /// guard of `api.rs` refuses every method but `GET` with `405`.
    #[test]
    fn read_only() {
        let mut files = Vec::new();
        sources(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut files,
        );
        assert!(files.len() >= 7, "the sources were not found");
        let mut gets = 0;
        for path in files {
            let text = std::fs::read_to_string(&path).unwrap();
            let code: String = without_tests(&text)
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            for method in [
                ".set(",
                ".set_blocking(",
                ".del(",
                ".del_blocking(",
                ".new_data_set_writer_id",
            ] {
                assert!(!code.contains(method), "{}: {method}", path.display());
            }
            // the HTTP side (C-088): no method but GET is served, no
            // request body is read
            for http in [
                "Method::POST",
                "Method::PUT",
                "Method::PATCH",
                "Method::DELETE",
                "\"POST\"=>",
                "\"PUT\"=>",
                "\"PATCH\"=>",
                "\"DELETE\"=>",
                "into_body(",
                "collect_body",
            ] {
                assert!(!code.contains(http), "{}: {http}", path.display());
            }
            if path.ends_with("api.rs") {
                gets += 1;
                assert!(code.contains(r#"ifh.method!="GET"{returnErr((405,"#));
            }
        }
        assert_eq!(gets, 1, "the method guard of api.rs");
    }

    /// The scan sees code after a test module and in front of it.
    #[test]
    fn test_modules_only_are_skipped() {
        let text = "a.set(1);\n#[cfg(test)]\nmod api_tests;\n#[cfg(test)]\nmod tests {\n fn f() { x.set(2); }\n}\nb.del(3);";
        let code = super::tests::without_tests(text);
        assert!(code.contains("a.set(1)"));
        assert!(code.contains("mod api_tests;"));
        assert!(!code.contains("x.set(2)"));
        assert!(code.contains("b.del(3)"));
    }

    /// The settings: the defaults of the definition, bounded.
    #[test]
    fn settings() {
        let values = super::config().values().unwrap();
        for s in super::SETTINGS {
            assert_eq!(
                values.number(super::GROUP, s.name),
                Some(f64::from(s.default))
            );
            assert!(s.min <= s.default && s.default <= s.max, "{}", s.name);
        }
        assert_eq!(super::whole(None, 7), 7);
        assert_eq!(super::whole(Some(f64::NAN), 7), 7);
        assert_eq!(super::whole(Some(-1.0), 7), 0);
        assert_eq!(super::whole(Some(2.9), 7), 2);
    }
}
