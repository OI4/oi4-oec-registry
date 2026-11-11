//! The directory of the registry (ADR-0029 §3, §6): one entry per
//! Identification Link, fed by the `Pub/MAM`, `Pub/Health`, `Pub/Profile`,
//! `Pub/Event`, `Pub/PublicationList` and `Pub/SubscriptionList` messages
//! on the bus and by the answers to the registry's `Get`s. Sans-IO: every
//! message returns the effects for the bus side – list or unlist an
//! available asset in the Registry services (MG A1, REQ-REG-002) and ask an
//! application with `Get` (ADR-0029 §4).
//!
//! Rules (MG 6.3, MG A1, REQ-LIFE-011 … 013):
//! 1. A `Pub/MAM` of an application about itself without `ReplyTo` is its
//!    Birth: the application is online. While it is online, such a MAM is
//!    a change of its MAM (REQ-RES-MAM-018).
//! 2. An application not yet known is online with its first `MAM` or
//!    `Health` about itself.
//! 3. A `Health` of an application about itself with `NORMAL_0`/0 is its
//!    Close (offline graceful), with `FAILURE_1`/0 its Will or a broken
//!    state (offline ungraceful); online again only after its next Birth.
//! 4. A device is online while its publisher is online and its MAM was
//!    received since the publisher came online; it goes offline with its
//!    publisher.
//! 5. Available = online with MAM and Health known; only available assets
//!    are listed.
//! 6. When an application comes online (rules 1 and 2) the registry asks
//!    it once with `Get` (without Source) for `MAM`, `Health`, `Profile`,
//!    `PublicationList` and `SubscriptionList` (increment 2, C-087): the
//!    answers cover its devices too and show which methods and resources
//!    it serves. Later, `MAM` and `Health` are asked again while one is
//!    missing for the application or a device.
//!
//! Collected besides MAM and Health (MG A1 optional, REQ-REG-004/005): the
//! Profile per entry, a bounded history of Health changes, a bounded trail
//! of the Events of all participants, the PublicationList and
//! SubscriptionList per application, the answers per entry, the schema
//! conformity per participant (counted by the bus side, [`Conformity`]) and
//! the observed Messaging level (informative, REQ-CMP-013, [`Observed`]).
//!
//! The data logger (amendment 2026-11-28): the last value of every `Data`
//! DataSet on the bus ([`DataRecord`]), in memory only, no history.
//!
//! 7. An Identification Link is an application's once the application
//!    publishes its own MAM or Health: a device entry about it, created
//!    by another publisher, is dropped and the application starts as in
//!    rule 2 (C-113 RR-1). A device is not taken over by another publisher
//!    while its publisher is online.
//!
//! Ignored (counted): the registry's own messages, the republications of
//! other registries (a `Source` ≠ `AppId` under ServiceType Registry is a
//! listed asset there, not a represented one), a MAM whose
//! ProductInstanceUri is not its `Source`, a device message about a known
//! application or a participant seen on the bus under its own AppId, a MAM
//! or Health of another publisher about the device of an online publisher
//! (rule 7), and – bounding the memory (C-113 RR-3) – a MAM, Health,
//! Profile, Event or list entry longer than [`VALUE_MAX`], a new asset
//! when [`ENTRIES`] are kept and none is offline, a list entry beyond
//! [`LIST_ENTRIES`].

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use oec::ServiceType;
use oec::consumer::{Health, HealthState, Resource};
use oec::identity::Mam;
use oec_core::resource::{Event, PublicationEntry, SubscriptionEntry};
use oec_core::topic::{Service, Subject};

/// What an entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// `Source` = `AppId`: an application with its own MQTT client.
    Application,
    /// `Source` ≠ `AppId`: an entity represented by its publisher.
    Device,
}

/// Online state of an entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Availability {
    /// After its Birth or first sighting (device: see rule 4).
    Online,
    /// After its Close; a device whose publisher is online but whose MAM
    /// was not received since.
    OfflineGraceful,
    /// After its Will or `FAILURE_1`/0 about itself.
    OfflineUngraceful,
}

/// The outcome of the requests for a resource of an entry since its
/// publisher came online.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Answer {
    /// Answered (an answer with `ReplyTo` about the entry, or the
    /// registry's `Get` was answered, an empty list included).
    Answered,
    /// The registry's `Get` got no answer in time.
    Timeout,
    /// The registry's `Get` was refused or failed otherwise.
    Refused(String),
}

/// One asset (ADR-0029 §3).
#[derive(Debug, Clone)]
pub(crate) struct Entry {
    /// Identification Link (`Source`, `DataSetWriterName`).
    pub(crate) il: String,
    pub(crate) kind: Kind,
    /// ServiceType of the publisher.
    pub(crate) service_type: ServiceType,
    /// AppId of the publisher (the entry itself for an application).
    pub(crate) publisher: String,
    pub(crate) mam: Option<Mam>,
    pub(crate) health: Option<Health>,
    pub(crate) availability: Availability,
    /// Times of the registry clock (Unix ms).
    pub(crate) first_seen: u64,
    pub(crate) last_seen: u64,
    pub(crate) online_since: Option<u64>,
    /// The resources and services of its last Profile.
    pub(crate) profile: Option<Vec<Subject>>,
    /// The changes of its Health (time, Health without details), oldest
    /// first, bounded by [`Limits::health_history`].
    pub(crate) health_history: VecDeque<(u64, Health)>,
    /// The answers per resource since its publisher came online.
    pub(crate) answers: BTreeMap<Want, Answer>,
    /// PublicationList and SubscriptionList (applications): the last
    /// complete answer to the registry's `Get`, updated by later entries.
    pub(crate) publications: Vec<PublicationEntry>,
    pub(crate) subscriptions: Vec<SubscriptionEntry>,
    /// The resources received about it at all (Level 1 of [`Observed`]).
    seen: BTreeSet<Want>,
    /// Time of the last MAM (rule 4).
    mam_at: Option<u64>,
}

impl Entry {
    fn new(il: &str, kind: Kind, o: &Origin<'_>) -> Self {
        Self {
            il: il.to_owned(),
            kind,
            service_type: o.service_type,
            publisher: o.app.to_owned(),
            mam: None,
            health: None,
            availability: Availability::OfflineGraceful,
            first_seen: o.now,
            last_seen: o.now,
            online_since: None,
            profile: None,
            health_history: VecDeque::new(),
            answers: BTreeMap::new(),
            publications: Vec::new(),
            subscriptions: Vec::new(),
            seen: BTreeSet::new(),
            mam_at: None,
        }
    }

    /// Available (MG A1): online with MAM and Health known.
    pub(crate) fn available(&self) -> bool {
        self.availability == Availability::Online && self.mam.is_some() && self.health.is_some()
    }

    /// Online now; `true` if it was not.
    fn online(&mut self, now: u64) -> bool {
        if self.availability == Availability::Online {
            return false;
        }
        self.availability = Availability::Online;
        self.online_since = Some(now);
        true
    }

    fn received(&mut self, want: Want, reply: bool) {
        self.seen.insert(want);
        if reply {
            self.answers.insert(want, Answer::Answered);
        }
    }

    fn answered(&self, want: Want) -> bool {
        self.answers.get(&want) == Some(&Answer::Answered)
    }
}

/// Where a message came from.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Origin<'a> {
    pub(crate) service_type: ServiceType,
    /// AppId of the topic.
    pub(crate) app: &'a str,
    /// `Source` of the message (its DataSetWriterName).
    pub(crate) source: &'a str,
    /// The message answers a `Get` (`ReplyTo` set).
    pub(crate) reply: bool,
    /// Registry clock, Unix ms.
    pub(crate) now: u64,
}

/// What the registry asks an application for, in this order (without
/// Source: the answer covers the application and its devices).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Want {
    Mam,
    Health,
    Profile,
    PublicationList,
    SubscriptionList,
}

impl Want {
    /// Everything, in the order of the requests (rule 6).
    pub(crate) const ALL: [Self; 5] = [
        Self::Mam,
        Self::Health,
        Self::Profile,
        Self::PublicationList,
        Self::SubscriptionList,
    ];

    /// The resource of the `Get`.
    pub(crate) fn resource(self) -> Resource {
        match self {
            Self::Mam => Resource::Mam,
            Self::Health => Resource::Health,
            Self::Profile => Resource::Profile,
            Self::PublicationList => Resource::PublicationList,
            Self::SubscriptionList => Resource::SubscriptionList,
        }
    }
}

/// A `Get` to an application.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Fetch {
    pub(crate) service_type: ServiceType,
    pub(crate) app: String,
    pub(crate) want: Want,
}

/// An effect for the bus side.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Effect {
    /// List or replace an available asset (MG A1).
    List {
        il: String,
        mam: Box<Mam>,
        health: Health,
    },
    /// Remove an asset that is no longer available.
    Unlist(String),
    /// Ask an application.
    Fetch(Fetch),
}

/// The bounds of the collected histories (the registry's Config, group
/// `directory`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Limits {
    /// Health changes kept per entry.
    pub(crate) health_history: usize,
    /// Events kept in the trail.
    pub(crate) event_trail: usize,
    /// Schema violations kept per participant.
    pub(crate) violation_trail: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            health_history: 20,
            event_trail: 200,
            violation_trail: 10,
        }
    }
}

/// One Event of the trail.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EventRecord {
    /// Its number, counting from 1 since the start of the registry (the
    /// HTTP side streams the Events after the last number it sent).
    pub(crate) seq: u64,
    /// Registry clock, Unix ms.
    pub(crate) at: u64,
    /// AppId of the publisher.
    pub(crate) publisher: String,
    /// Its `Source` (DataSetWriterName).
    pub(crate) source: String,
    /// The Filter of its topic (category and level, MG 7.6).
    pub(crate) filter: Option<String>,
    pub(crate) event: Event,
}

/// The data logger keeps the last value of at most this many DataSets;
/// beyond, the one updated longest ago is dropped.
pub(crate) const DATA_SETS: usize = 1000;
/// The longest Payload kept (JSON text, octets); a longer one is kept
/// without its Payload.
pub(crate) const DATA_MAX: usize = 16 * 1024;

/// The directory keeps at most this many entries, and the conformity view
/// at most this many participants (C-113 RR-3): an edge host runs tens of
/// applications that represent up to some thousand devices. When full, the
/// offline entry seen longest ago gives way; an online or listed one never
/// does: then a new asset is ignored. With [`VALUE_MAX`] the MAMs and
/// Healths of all entries take at most 64 MiB (the listed ones once more
/// in the SDK).
pub(crate) const ENTRIES: usize = 4096;
/// The longest MAM, Health, Profile, Event or list entry kept (JSON text,
/// octets; C-113 RR-3): a longer one is ignored. A MAM of an SDK
/// application takes well below 1 KiB.
pub(crate) const VALUE_MAX: usize = 8 * 1024;
/// The PublicationList and SubscriptionList entries kept over all
/// applications (C-113 RR-3); beyond, a new one is ignored.
pub(crate) const LIST_ENTRIES: usize = 4096;
/// The longest topic and message of a [`Violation`] kept, in characters.
pub(crate) const TEXT_MAX: usize = 512;

/// Counts the octets of a JSON text; fails beyond [`VALUE_MAX`], so a
/// large value is not written out in full.
struct Bounded(usize);

impl std::io::Write for Bounded {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 += buf.len();
        if self.0 > VALUE_MAX {
            return Err(std::io::ErrorKind::FileTooLarge.into());
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Whether the JSON text that `write` writes is at most [`VALUE_MAX`]
/// octets long (C-113 RR-3).
fn fits(write: impl FnOnce(&mut Bounded) -> serde_json::Result<()>) -> bool {
    write(&mut Bounded(0)).is_ok()
}

/// The last value of one `Data` DataSet (the data logger, amendment
/// 2026-11-28), keyed by publisher, Source and Filter.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DataRecord {
    /// The number of the update, counting from 1 since the start of the
    /// registry over all DataSets.
    pub(crate) seq: u64,
    /// Registry clock, Unix ms.
    pub(crate) at: u64,
    /// AppId of the publisher.
    pub(crate) publisher: String,
    /// Its `Source` (DataSetWriterName).
    pub(crate) source: String,
    /// The Filter of its topic, else its WriterGroupName: the DataSet.
    pub(crate) filter: Option<String>,
    pub(crate) data_set_writer_id: u16,
    /// The Payload as received; `None` if longer than [`DATA_MAX`].
    pub(crate) payload: Option<serde_json::Value>,
}

/// A message that violates the D1 schemas (or is no message at all).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Violation {
    /// Registry clock, Unix ms.
    pub(crate) at: u64,
    pub(crate) topic: String,
    /// The violated requirements, sorted and unique; empty if unknown.
    pub(crate) reqs: Vec<String>,
    /// What is wrong (bounded).
    pub(crate) message: String,
}

/// The schema conformity of one participant (ADR-0029 §6), judged by the
/// bus side with the strict D1 schemas, independent of D7.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Conformity {
    /// Checked messages (NetworkMessages).
    pub(crate) messages: u64,
    /// Of which violate the schemas.
    pub(crate) violations: u64,
    /// The last violations, oldest first, bounded by
    /// [`Limits::violation_trail`].
    pub(crate) last: VecDeque<Violation>,
    /// The number of its last check: the participant checked longest ago
    /// gives way when the view is full ([`ENTRIES`]).
    seq: u64,
}

/// The observed Messaging level of an entry (REQ-CMP-013, ADR-0008):
/// informative, never a compliance claim; derived from what the registry
/// received about the entry since its publisher came online.
///
/// - Level 1: MAM and Health about it received (REQ-CMP-014).
/// - Level 2: `Get` answered (REQ-CMP-015), `MAM` and `Health` among the
///   answers (REQ-CMP-017).
/// - Level 3: its Profile answered (REQ-CMP-018) and listing
///   ReferenceDesignation (REQ-CMP-020), Config, Data, Metadata and Event
///   (REQ-CMP-035 … 038); for an application also PublicationList and
///   SubscriptionList, listed and answered (REQ-CMP-019, REQ-CMP-039), and
///   the service NewDataSetWriterId (REQ-CMP-034).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Observed {
    /// 0 (not yet seen) … 3.
    pub(crate) level: u8,
    /// The requirements of the next level not observed (empty at 3).
    pub(crate) missing: Vec<&'static str>,
}

/// The directory: see the [module](self).
#[derive(Debug)]
pub(crate) struct Directory {
    me: String,
    entries: BTreeMap<String, Entry>,
    listed: BTreeSet<String>,
    ignored: u64,
    limits: Limits,
    events: VecDeque<EventRecord>,
    /// The number of Events received so far (the last [`EventRecord::seq`]).
    events_seen: u64,
    conformity: BTreeMap<String, Conformity>,
    /// The number of checked messages (the last [`Conformity::seq`]).
    checks: u64,
    /// The data logger: (publisher, Source, Filter) → last value.
    data: BTreeMap<(String, String, Option<String>), DataRecord>,
    data_seen: u64,
}

fn fetch(o: &Origin<'_>, want: Want) -> Effect {
    Effect::Fetch(Fetch {
        service_type: o.service_type,
        app: o.app.to_owned(),
        want,
    })
}

fn fetch_all<'a>(o: &'a Origin<'_>) -> impl Iterator<Item = Effect> + 'a {
    Want::ALL.into_iter().map(|w| fetch(o, w))
}

fn is_close(h: &Health) -> bool {
    h.health == HealthState::Normal && h.health_score == Some(0)
}

fn is_will(h: &Health) -> bool {
    h.health == HealthState::Failure && h.health_score == Some(0)
}

fn trim<T>(q: &mut VecDeque<T>, max: usize) {
    while q.len() > max {
        q.pop_front();
    }
}

/// Puts each item in `list`, replacing one with the same key; a new key
/// only while `list` is shorter than `max`. Returns the number of items
/// dropped: without room or not `ok` (too long).
fn upsert<T, K: PartialEq>(
    list: &mut Vec<T>,
    items: Vec<T>,
    key: impl Fn(&T) -> K,
    ok: impl Fn(&T) -> bool,
    max: usize,
) -> u64 {
    let mut dropped = 0;
    for item in items {
        if !ok(&item) {
            dropped += 1;
            continue;
        }
        match list.iter().position(|x| key(x) == key(&item)) {
            Some(i) => list[i] = item,
            None if list.len() < max => list.push(item),
            None => dropped += 1,
        }
    }
    dropped
}

/// Replaces `list` by the first `max` items that are `ok`; returns the
/// number of items dropped.
fn replace<T>(list: &mut Vec<T>, items: Vec<T>, ok: impl Fn(&T) -> bool, max: usize) -> u64 {
    let n = items.len();
    *list = items.into_iter().filter(|x| ok(x)).take(max).collect();
    (n - list.len()) as u64
}

fn publication_fits(p: &PublicationEntry) -> bool {
    fits(|w| serde_json::to_writer(w, p))
}

fn subscription_fits(s: &SubscriptionEntry) -> bool {
    fits(|w| serde_json::to_writer(w, s))
}

fn publication_key(p: &PublicationEntry) -> (Resource, String, Option<String>) {
    (p.resource, p.source.clone(), p.filter.clone())
}

/// The Profile entries of Level 3 (see [`Observed`]); the last field: only
/// for applications.
const PROFILE_L3: [(Subject, &str, bool); 8] = [
    (
        Subject::Resource(Resource::PublicationList),
        "REQ-CMP-019",
        true,
    ),
    (
        Subject::Resource(Resource::ReferenceDesignation),
        "REQ-CMP-020",
        false,
    ),
    (
        Subject::Service(Service::NewDataSetWriterId),
        "REQ-CMP-034",
        true,
    ),
    (Subject::Resource(Resource::Config), "REQ-CMP-035", false),
    (Subject::Resource(Resource::Data), "REQ-CMP-036", false),
    (Subject::Resource(Resource::Metadata), "REQ-CMP-037", false),
    (Subject::Resource(Resource::Event), "REQ-CMP-038", false),
    (
        Subject::Resource(Resource::SubscriptionList),
        "REQ-CMP-039",
        true,
    ),
];

impl Directory {
    /// The directory of the registry with the AppId `me`.
    pub(crate) fn new(me: &str) -> Self {
        Self {
            me: me.to_owned(),
            entries: BTreeMap::new(),
            listed: BTreeSet::new(),
            ignored: 0,
            limits: Limits::default(),
            events: VecDeque::new(),
            events_seen: 0,
            conformity: BTreeMap::new(),
            checks: 0,
            data: BTreeMap::new(),
            data_seen: 0,
        }
    }

    /// The entries, sorted by Identification Link.
    pub(crate) fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.entries.values()
    }

    /// One entry.
    pub(crate) fn get(&self, il: &str) -> Option<&Entry> {
        self.entries.get(il)
    }

    /// The devices of the application `app` (the publisher relation, MG A1
    /// optional), sorted by Identification Link.
    pub(crate) fn devices<'a>(&'a self, app: &'a str) -> impl Iterator<Item = &'a Entry> + 'a {
        self.entries
            .values()
            .filter(move |e| e.kind == Kind::Device && e.publisher == app)
    }

    /// The AppId of the registry itself.
    pub(crate) fn me(&self) -> &str {
        &self.me
    }

    /// The number of ignored messages.
    pub(crate) fn ignored(&self) -> u64 {
        self.ignored
    }

    /// The bounds of the histories.
    pub(crate) fn limits(&self) -> Limits {
        self.limits
    }

    /// Changes the bounds; longer histories are cut at once.
    pub(crate) fn set_limits(&mut self, limits: Limits) {
        self.limits = limits;
        for e in self.entries.values_mut() {
            trim(&mut e.health_history, limits.health_history);
        }
        trim(&mut self.events, limits.event_trail);
        for c in self.conformity.values_mut() {
            trim(&mut c.last, limits.violation_trail);
        }
    }

    /// The Event trail, oldest first.
    pub(crate) fn events(&self) -> impl Iterator<Item = &EventRecord> {
        self.events.iter()
    }

    /// The schema conformity of the participant with the AppId `app`.
    pub(crate) fn conformity(&self, app: &str) -> Option<&Conformity> {
        self.conformity.get(app)
    }

    fn ignore(&mut self, o: &Origin<'_>) -> bool {
        let skip = o.app == self.me
            || (o.service_type == ServiceType::Registry && o.source != o.app)
            || (o.source != o.app
                && (self.conformity.contains_key(o.source)
                    || self
                        .entries
                        .get(o.source)
                        .is_some_and(|e| e.kind == Kind::Application)));
        if skip {
            self.ignored += 1;
        }
        skip
    }

    /// Rule 6: the application `app` came online; the answers of it and
    /// its devices from before do not count.
    fn reborn(&mut self, app: &str) {
        for e in self.entries.values_mut() {
            if e.il == app || (e.kind == Kind::Device && e.publisher == app) {
                e.answers.clear();
            }
        }
    }

    /// Whether a MAM or Health about `o.source` may change the directory:
    /// - C-113 RR-1: the application's own message takes its IL back from
    ///   a device entry another publisher created (squatting): the entry
    ///   is dropped, the application starts afresh (rule 2);
    /// - C-113 RR-1: the device of an online publisher is not taken over by
    ///   another publisher;
    /// - C-113 RR-3: a new entry needs room ([`ENTRIES`]).
    fn admit(&mut self, o: &Origin<'_>) -> bool {
        if let Some(e) = self.entries.get(o.source) {
            if o.source != o.app {
                let online = |p: &Entry| p.availability == Availability::Online;
                return e.publisher == o.app || !self.entries.get(&e.publisher).is_some_and(online);
            }
            if e.kind == Kind::Application {
                return true;
            }
            self.entries.remove(o.source);
        }
        if self.entries.len() < ENTRIES {
            return true;
        }
        let gone = self
            .entries
            .values()
            .filter(|e| e.availability != Availability::Online && !self.listed.contains(&e.il))
            .min_by_key(|e| e.last_seen)
            .map(|e| e.il.clone());
        gone.is_some_and(|il| self.entries.remove(&il).is_some())
    }

    /// A `Pub/MAM` message.
    pub(crate) fn mam(&mut self, o: &Origin<'_>, mam: Mam) -> Vec<Effect> {
        if self.ignore(o) {
            return Vec::new();
        }
        if mam.product_instance_uri != o.source
            || !fits(|w| serde_json::to_writer(w, &mam))
            || !self.admit(o)
        {
            self.ignored += 1;
            return Vec::new();
        }
        let mut out = Vec::new();
        if o.source == o.app {
            let known = self.entries.contains_key(o.app);
            let e = self
                .entries
                .entry(o.app.to_owned())
                .or_insert_with(|| Entry::new(o.app, Kind::Application, o));
            e.last_seen = o.now;
            e.service_type = o.service_type;
            let was_online = known && e.availability == Availability::Online;
            let came = (!known || (!was_online && !o.reply)) && {
                // Birth or first sighting; a Health from before is stale
                if known {
                    e.health = None;
                }
                e.online(o.now)
            };
            e.mam = Some(mam);
            e.mam_at = Some(o.now);
            let health = e.availability == Availability::Online && e.health.is_none();
            if came {
                self.reborn(o.app);
                out.extend(fetch_all(o));
            } else if health {
                out.push(fetch(o, Want::Health));
            }
        } else {
            let e = self.device(o);
            e.mam = Some(mam);
            e.mam_at = Some(o.now);
            let health = e.health.is_none();
            match self.entries.get(o.app).map(|p| p.availability) {
                None => out.push(fetch(o, Want::Mam)),
                Some(Availability::Online) if health => out.push(fetch(o, Want::Health)),
                _ => {}
            }
        }
        out.extend(self.sync(o.app));
        self.received(o, Want::Mam);
        out
    }

    /// A `Pub/Health` message.
    pub(crate) fn health(&mut self, o: &Origin<'_>, health: Health) -> Vec<Effect> {
        if self.ignore(o) {
            return Vec::new();
        }
        if !fits(|w| serde_json::to_writer(w, &health)) || !self.admit(o) {
            self.ignored += 1;
            return Vec::new();
        }
        let mut out = Vec::new();
        let keep = self.limits.health_history;
        if o.source == o.app {
            let known = self.entries.contains_key(o.app);
            let e = self
                .entries
                .entry(o.app.to_owned())
                .or_insert_with(|| Entry::new(o.app, Kind::Application, o));
            e.last_seen = o.now;
            e.service_type = o.service_type;
            let mut came = false;
            if is_close(&health) {
                e.availability = Availability::OfflineGraceful;
                e.online_since = None;
            } else if is_will(&health) {
                e.availability = Availability::OfflineUngraceful;
                e.online_since = None;
            } else if !known {
                came = e.online(o.now);
            }
            remember(e, o.now, &health, keep);
            e.health = Some(health);
            let mam = e.availability == Availability::Online && e.mam.is_none();
            if came {
                self.reborn(o.app);
                out.extend(fetch_all(o));
            } else if mam {
                out.push(fetch(o, Want::Mam));
            }
        } else {
            let e = self.device(o);
            remember(e, o.now, &health, keep);
            e.health = Some(health);
            let mam = e.mam.is_none();
            match self.entries.get(o.app).map(|p| p.availability) {
                None => out.push(fetch(o, Want::Mam)),
                Some(Availability::Online) if mam => out.push(fetch(o, Want::Mam)),
                _ => {}
            }
        }
        out.extend(self.sync(o.app));
        self.received(o, Want::Health);
        out
    }

    /// A `Pub/Profile` message about a known entry.
    pub(crate) fn profile(&mut self, o: &Origin<'_>, resources: Vec<Subject>) {
        if self.ignore(o) {
            return;
        }
        if !fits(|w| serde_json::to_writer(w, &resources)) {
            self.ignored += 1;
            return;
        }
        if let Some(e) = self.known(o) {
            e.profile = Some(resources);
            e.received(Want::Profile, o.reply);
        }
    }

    /// A `Pub/Event` message: into the trail.
    pub(crate) fn event(&mut self, o: &Origin<'_>, filter: Option<String>, event: Event) {
        if self.ignore(o) {
            return;
        }
        if !fits(|w| serde_json::to_writer(w, &event)) {
            self.ignored += 1;
            return;
        }
        self.events_seen += 1;
        self.events.push_back(EventRecord {
            seq: self.events_seen,
            at: o.now,
            publisher: o.app.to_owned(),
            source: o.source.to_owned(),
            filter,
            event,
        });
        trim(&mut self.events, self.limits.event_trail);
    }

    /// The last values of the data logger, by publisher, Source and Filter.
    pub(crate) fn data_sets(&self) -> impl Iterator<Item = &DataRecord> {
        self.data.values()
    }

    /// A `Pub/Data` DataSetMessage: its value replaces the last one of the
    /// DataSet (`filter`: the Filter of the topic or the WriterGroupName).
    pub(crate) fn data(
        &mut self,
        o: &Origin<'_>,
        filter: Option<String>,
        data_set_writer_id: u16,
        payload: serde_json::Value,
    ) {
        if self.ignore(o) {
            return;
        }
        let key = (o.app.to_owned(), o.source.to_owned(), filter.clone());
        if !self.data.contains_key(&key)
            && self.data.len() >= DATA_SETS
            && let Some(oldest) = self
                .data
                .iter()
                .min_by_key(|(_, r)| r.seq)
                .map(|(k, _)| k.clone())
        {
            self.data.remove(&oldest);
        }
        let fits = serde_json::to_string(&payload).is_ok_and(|t| t.len() <= DATA_MAX);
        self.data_seen += 1;
        self.data.insert(
            key,
            DataRecord {
                seq: self.data_seen,
                at: o.now,
                publisher: o.app.to_owned(),
                source: o.source.to_owned(),
                filter,
                data_set_writer_id,
                payload: fits.then_some(payload),
            },
        );
    }

    /// `Pub/PublicationList` entries of the application `o.app`.
    pub(crate) fn publications(&mut self, o: &Origin<'_>, entries: Vec<PublicationEntry>) {
        if o.app == self.me {
            return;
        }
        let free = self.list_room();
        if let Some(e) = self.application(o.app) {
            let max = e.publications.len() + free;
            let dropped = upsert(
                &mut e.publications,
                entries,
                publication_key,
                publication_fits,
                max,
            );
            e.received(Want::PublicationList, o.reply);
            self.ignored += dropped;
        }
    }

    /// `Pub/SubscriptionList` entries of the application `o.app`.
    pub(crate) fn subscriptions(&mut self, o: &Origin<'_>, entries: Vec<SubscriptionEntry>) {
        if o.app == self.me {
            return;
        }
        let free = self.list_room();
        if let Some(e) = self.application(o.app) {
            let max = e.subscriptions.len() + free;
            let dropped = upsert(
                &mut e.subscriptions,
                entries,
                |s| s.topic_path.clone(),
                subscription_fits,
                max,
            );
            e.received(Want::SubscriptionList, o.reply);
            self.ignored += dropped;
        }
    }

    /// The list entries that may still be kept ([`LIST_ENTRIES`]).
    fn list_room(&self) -> usize {
        let kept: usize = self
            .entries
            .values()
            .map(|e| e.publications.len() + e.subscriptions.len())
            .sum();
        LIST_ENTRIES.saturating_sub(kept)
    }

    /// The outcome of the registry's `Get` `f`. A complete answer to `Get
    /// PublicationList` or `Get SubscriptionList` (without Source and
    /// Filter) replaces the list of the application.
    pub(crate) fn asked(&mut self, f: &Fetch, answer: Answer, lists: Lists) {
        let free = self.list_room();
        let Some(e) = self.application(&f.app) else {
            return;
        };
        let mut dropped = 0;
        if answer == Answer::Answered {
            match lists {
                Lists::Publications(p) => {
                    let max = e.publications.len() + free;
                    dropped = replace(&mut e.publications, p, publication_fits, max);
                }
                Lists::Subscriptions(s) => {
                    let max = e.subscriptions.len() + free;
                    dropped = replace(&mut e.subscriptions, s, subscription_fits, max);
                }
                Lists::None => {}
            }
            e.answers.insert(f.want, Answer::Answered);
        } else if !e.answered(f.want) {
            e.answers.insert(f.want, answer);
        }
        self.ignored += dropped;
    }

    /// A message of the participant `app` was checked against the schemas
    /// (`None`: it conforms). At most [`ENTRIES`] participants (C-113
    /// RR-3): the one checked longest ago gives way unless it is online;
    /// if all are, a new participant is not recorded.
    pub(crate) fn checked(&mut self, app: &str, violation: Option<Violation>) {
        if app == self.me {
            return;
        }
        if !self.conformity.contains_key(app) && self.conformity.len() >= ENTRIES {
            let online = |a: &String| {
                self.entries
                    .get(a)
                    .is_some_and(|e| e.availability == Availability::Online)
            };
            let gone = self
                .conformity
                .iter()
                .filter(|(a, _)| !online(a))
                .min_by_key(|(_, c)| c.seq)
                .map(|(a, _)| a.clone());
            match gone {
                Some(a) => self.conformity.remove(&a),
                None => return,
            };
        }
        self.checks += 1;
        let c = self.conformity.entry(app.to_owned()).or_default();
        c.messages += 1;
        c.seq = self.checks;
        if let Some(mut v) = violation {
            v.topic = v.topic.chars().take(TEXT_MAX).collect();
            v.message = v.message.chars().take(TEXT_MAX).collect();
            c.violations += 1;
            c.last.push_back(v);
            trim(&mut c.last, self.limits.violation_trail);
        }
    }

    /// The observed Messaging level of the entry `il` (see [`Observed`]).
    pub(crate) fn observed(&self, il: &str) -> Option<Observed> {
        let e = self.entries.get(il)?;
        let app = e.kind == Kind::Application;
        let mut levels: [Vec<&'static str>; 3] = Default::default();
        if !(e.seen.contains(&Want::Mam) && e.seen.contains(&Want::Health)) {
            levels[0].push("REQ-CMP-014");
        }
        if !e.answers.values().any(|a| *a == Answer::Answered) {
            levels[1].push("REQ-CMP-015");
        }
        if !(e.answered(Want::Mam) && e.answered(Want::Health)) {
            levels[1].push("REQ-CMP-017");
        }
        let l3 = &mut levels[2];
        if !e.answered(Want::Profile) {
            l3.push("REQ-CMP-018");
        }
        let profile = e.profile.as_deref().unwrap_or_default();
        for (subject, req, apps_only) in PROFILE_L3 {
            if (app || !apps_only) && !profile.contains(&subject) {
                l3.push(req);
            }
        }
        if app && !e.answered(Want::PublicationList) && !l3.contains(&"REQ-CMP-019") {
            l3.push("REQ-CMP-019");
        }
        if app && !e.answered(Want::SubscriptionList) && !l3.contains(&"REQ-CMP-039") {
            l3.push("REQ-CMP-039");
        }
        l3.sort_unstable();
        let reached = levels.iter().take_while(|m| m.is_empty()).count();
        Some(Observed {
            level: u8::try_from(reached).unwrap_or(3),
            missing: levels.get(reached).cloned().unwrap_or_default(),
        })
    }

    /// Whether `f` is still needed: the application is unknown (only for
    /// its MAM), or online and has not answered it since it came online,
    /// or (MAM, Health) lacks it for itself or one of its devices.
    pub(crate) fn missing(&self, f: &Fetch) -> bool {
        let Some(app) = self.entries.get(&f.app) else {
            return f.want == Want::Mam;
        };
        if app.availability != Availability::Online {
            return false;
        }
        if !app.answers.contains_key(&f.want) {
            return true;
        }
        let lacks = |e: &Entry| match f.want {
            Want::Mam => e.mam.is_none(),
            Want::Health => e.health.is_none(),
            _ => false,
        };
        lacks(app)
            || self
                .entries
                .values()
                .any(|e| e.kind == Kind::Device && e.publisher == f.app && lacks(e))
    }

    fn known(&mut self, o: &Origin<'_>) -> Option<&mut Entry> {
        let e = self.entries.get_mut(o.source)?;
        (e.publisher == o.app).then_some(e)
    }

    fn application(&mut self, app: &str) -> Option<&mut Entry> {
        self.entries
            .get_mut(app)
            .filter(|e| e.kind == Kind::Application)
    }

    /// Marks `want` received about `o.source` after the effects of rule 6.
    fn received(&mut self, o: &Origin<'_>, want: Want) {
        if let Some(e) = self.known(o) {
            e.received(want, o.reply);
        }
    }

    fn device(&mut self, o: &Origin<'_>) -> &mut Entry {
        let e = self
            .entries
            .entry(o.source.to_owned())
            .or_insert_with(|| Entry::new(o.source, Kind::Device, o));
        e.last_seen = o.now;
        o.app.clone_into(&mut e.publisher);
        e.service_type = o.service_type;
        e
    }

    /// Applies rule 4 to the devices of `app` and lists or unlists the
    /// application and its devices (rule 5).
    fn sync(&mut self, app: &str) -> Vec<Effect> {
        let (state, since) = match self.entries.get(app) {
            Some(a) if a.kind == Kind::Application => (a.availability, a.online_since),
            _ => (Availability::OfflineGraceful, None),
        };
        let mut out = Vec::new();
        for e in self.entries.values_mut() {
            if e.kind == Kind::Device && e.publisher == app {
                let fresh = matches!((since, e.mam_at), (Some(s), Some(m)) if m >= s);
                match state {
                    Availability::Online if fresh => {
                        let at = e.mam_at.unwrap_or_default();
                        e.online(at);
                    }
                    Availability::Online => e.availability = Availability::OfflineGraceful,
                    offline => e.availability = offline,
                }
                if e.availability != Availability::Online {
                    e.online_since = None;
                }
            } else if e.il != app {
                continue;
            }
            if e.available() {
                self.listed.insert(e.il.clone());
                out.push(Effect::List {
                    il: e.il.clone(),
                    mam: Box::new(e.mam.clone().expect("available")),
                    health: e.health.clone().expect("available"),
                });
            } else if self.listed.remove(&e.il) {
                out.push(Effect::Unlist(e.il.clone()));
            }
        }
        out
    }
}

/// The lists of a complete answer (see [`Directory::asked`]).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) enum Lists {
    #[default]
    None,
    Publications(Vec<PublicationEntry>),
    Subscriptions(Vec<SubscriptionEntry>),
}

/// Appends a changed Health (state or score) to the history, without its
/// details (C-113 RR-3: bounded per change; the latest Health keeps them).
fn remember(e: &mut Entry, now: u64, health: &Health, max: usize) {
    let changed = e
        .health_history
        .back()
        .is_none_or(|(_, h)| h.health != health.health || h.health_score != health.health_score);
    if changed {
        let change = Health {
            health: health.health,
            health_score: health.health_score,
            details: None,
        };
        e.health_history.push_back((now, change));
        trim(&mut e.health_history, max);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "oi4.org/OEC,20Registry/OEC-REGISTRY/reg-1";
    const APP: &str = "vendor.com/Gateway/GW-1/SN-1";
    const PUMP: &str = "vendor.com/Pump/P-1/0815";
    const OTHER: &str = "vendor.com/Other/O-1/1";

    fn mam(piu: &str) -> Mam {
        serde_json::from_value(serde_json::json!({
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

    fn health(state: HealthState, score: u8) -> Health {
        Health {
            health: state,
            health_score: Some(score),
            details: None,
        }
    }

    fn normal() -> Health {
        health(HealthState::Normal, 100)
    }

    fn at<'a>(app: &'a str, source: &'a str, reply: bool, now: u64) -> Origin<'a> {
        Origin {
            service_type: ServiceType::Aggregation,
            app,
            source,
            reply,
            now,
        }
    }

    fn listed(effects: &[Effect]) -> Vec<&str> {
        effects
            .iter()
            .filter_map(|e| match e {
                Effect::List { il, .. } => Some(il.as_str()),
                _ => None,
            })
            .collect()
    }

    fn unlisted(effects: &[Effect]) -> Vec<&str> {
        effects
            .iter()
            .filter_map(|e| match e {
                Effect::Unlist(il) => Some(il.as_str()),
                _ => None,
            })
            .collect()
    }

    fn fetches(effects: &[Effect]) -> Vec<Want> {
        effects
            .iter()
            .filter_map(|e| match e {
                Effect::Fetch(f) => Some(f.want),
                _ => None,
            })
            .collect()
    }

    fn state(d: &Directory, il: &str) -> Availability {
        d.get(il).unwrap().availability
    }

    /// Rules 1, 3 and 5: Birth, then Health → available; Close → offline
    /// graceful and unlisted; a heartbeat does not bring it back; the next
    /// Birth does.
    #[test]
    fn birth_close_and_rebirth() {
        let mut d = Directory::new(ME);
        let fx = d.mam(&at(APP, APP, false, 1), mam(APP));
        assert_eq!(state(&d, APP), Availability::Online);
        assert_eq!(fetches(&fx), Want::ALL, "rule 6");
        assert!(listed(&fx).is_empty(), "not available without Health");
        let fx = d.health(&at(APP, APP, false, 2), normal());
        assert_eq!(listed(&fx), [APP]);
        assert!(fetches(&fx).is_empty());

        let fx = d.health(&at(APP, APP, false, 3), health(HealthState::Normal, 0));
        assert_eq!(state(&d, APP), Availability::OfflineGraceful);
        assert_eq!(unlisted(&fx), [APP]);
        // answers and heartbeats do not bring it back (REQ-LIFE-013)
        let fx = d.health(&at(APP, APP, false, 4), normal());
        assert_eq!(state(&d, APP), Availability::OfflineGraceful);
        assert!(listed(&fx).is_empty());
        let fx = d.mam(&at(APP, APP, true, 5), mam(APP));
        assert_eq!(state(&d, APP), Availability::OfflineGraceful);
        assert!(listed(&fx).is_empty());

        // the next Birth: online, the old Health is stale
        let fx = d.mam(&at(APP, APP, false, 6), mam(APP));
        assert_eq!(state(&d, APP), Availability::Online);
        assert!(d.get(APP).unwrap().health.is_none());
        assert_eq!(fetches(&fx), Want::ALL);
        let fx = d.health(&at(APP, APP, false, 7), normal());
        assert_eq!(listed(&fx), [APP]);
        let e = d.get(APP).unwrap();
        assert_eq!((e.first_seen, e.last_seen, e.online_since), (1, 7, Some(6)));
    }

    /// Rule 3: the Will (FAILURE_1/0 about itself).
    #[test]
    fn will() {
        let mut d = Directory::new(ME);
        d.mam(&at(APP, APP, false, 1), mam(APP));
        d.health(&at(APP, APP, false, 2), normal());
        let fx = d.health(&at(APP, APP, false, 3), health(HealthState::Failure, 0));
        assert_eq!(state(&d, APP), Availability::OfflineUngraceful);
        assert_eq!(unlisted(&fx), [APP]);
        // FAILURE_1 with another score is a Health, not a Will
        d.mam(&at(APP, APP, false, 4), mam(APP));
        let fx = d.health(&at(APP, APP, false, 5), health(HealthState::Failure, 10));
        assert_eq!(state(&d, APP), Availability::Online);
        assert_eq!(listed(&fx), [APP]);
    }

    /// Rule 2: an application first seen by its heartbeat is online; the
    /// registry asks for its MAM, the answer (with ReplyTo) makes it
    /// available.
    #[test]
    fn first_sighting_by_heartbeat() {
        let mut d = Directory::new(ME);
        let fx = d.health(&at(APP, APP, false, 1), normal());
        assert_eq!(state(&d, APP), Availability::Online);
        assert_eq!(fetches(&fx), Want::ALL, "rule 6");
        assert!(d.missing(&Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want: Want::Mam
        }));
        let fx = d.mam(&at(APP, APP, true, 2), mam(APP));
        assert_eq!(listed(&fx), [APP]);
        assert!(!d.missing(&Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want: Want::Mam
        }));
        // a first sighting by an answer works as well
        let mut d = Directory::new(ME);
        d.mam(&at(APP, APP, true, 1), mam(APP));
        assert_eq!(state(&d, APP), Availability::Online);
    }

    /// Rule 4: devices follow their publisher; after a Birth of the
    /// publisher a device is online only with a MAM received since.
    #[test]
    fn devices_follow_their_publisher() {
        let mut d = Directory::new(ME);
        d.mam(&at(APP, APP, false, 1), mam(APP));
        d.health(&at(APP, APP, false, 1), normal());
        let fx = d.mam(&at(APP, PUMP, false, 2), mam(PUMP));
        assert_eq!(d.get(PUMP).unwrap().kind, Kind::Device);
        assert_eq!(state(&d, PUMP), Availability::Online);
        assert_eq!(fetches(&fx), [Want::Health]);
        let fx = d.health(&at(APP, PUMP, false, 3), normal());
        assert_eq!(listed(&fx), [APP, PUMP]);

        // the publisher leaves with its Will: the device goes with it
        let fx = d.health(&at(APP, APP, false, 4), health(HealthState::Failure, 0));
        assert_eq!(unlisted(&fx), [APP, PUMP]);
        assert_eq!(state(&d, PUMP), Availability::OfflineUngraceful);

        // Birth of the publisher: the device waits for its own MAM
        d.mam(&at(APP, APP, false, 5), mam(APP));
        let fx = d.health(&at(APP, APP, false, 6), normal());
        assert_eq!(listed(&fx), [APP]);
        assert_eq!(state(&d, PUMP), Availability::OfflineGraceful);
        let fx = d.mam(&at(APP, PUMP, false, 7), mam(PUMP));
        assert_eq!(listed(&fx), [APP, PUMP]);
        assert_eq!(d.get(PUMP).unwrap().online_since, Some(7));
    }

    /// A device of a publisher not yet known: the registry asks the
    /// publisher for its MAM (and gets the device's again).
    #[test]
    fn device_of_an_unknown_publisher() {
        let mut d = Directory::new(ME);
        let fx = d.health(&at(APP, PUMP, false, 1), normal());
        assert_eq!(fetches(&fx), [Want::Mam]);
        assert_eq!(state(&d, PUMP), Availability::OfflineGraceful);
        // the answer to Get MAM without Source: the publisher, then the device
        let fx = d.mam(&at(APP, APP, true, 2), mam(APP));
        assert_eq!(fetches(&fx), Want::ALL);
        let fx = d.mam(&at(APP, PUMP, true, 2), mam(PUMP));
        // available on its own: MAM and Health known, its publisher online
        assert_eq!(listed(&fx), [PUMP]);
        let fx = d.health(&at(APP, APP, true, 3), normal());
        assert_eq!(listed(&fx), [APP, PUMP]);
        assert!(!d.missing(&Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want: Want::Health
        }));
    }

    /// A MAM change of an online application (REQ-RES-MAM-018) is no new
    /// Birth: its devices stay online.
    #[test]
    fn mam_change_is_no_birth() {
        let mut d = Directory::new(ME);
        d.mam(&at(APP, APP, false, 1), mam(APP));
        d.health(&at(APP, APP, false, 1), normal());
        d.mam(&at(APP, PUMP, false, 2), mam(PUMP));
        d.health(&at(APP, PUMP, false, 2), normal());
        let mut changed = mam(APP);
        changed.revision_counter = 1;
        let fx = d.mam(&at(APP, APP, false, 3), changed.clone());
        assert_eq!(listed(&fx), [APP, PUMP]);
        assert_eq!(d.get(APP).unwrap().online_since, Some(1));
        assert_eq!(d.get(APP).unwrap().mam, Some(changed));
        assert!(d.get(APP).unwrap().health.is_some());
    }

    #[test]
    fn ignored_messages() {
        let mut d = Directory::new(ME);
        // own messages
        assert!(d.mam(&at(ME, ME, false, 1), mam(ME)).is_empty());
        // the republication of another registry
        let other = "oi4.org/OEC,20Registry/OEC-REGISTRY/reg-2";
        let o = Origin {
            service_type: ServiceType::Registry,
            ..at(other, PUMP, true, 1)
        };
        assert!(d.mam(&o, mam(PUMP)).is_empty());
        // ProductInstanceUri ≠ Source
        assert!(d.mam(&at(APP, APP, false, 1), mam(OTHER)).is_empty());
        assert_eq!(d.ignored(), 3);
        assert_eq!(d.entries().count(), 0);
        // a device message about a known application
        d.mam(&at(OTHER, OTHER, false, 2), mam(OTHER));
        assert!(d.health(&at(APP, OTHER, false, 3), normal()).is_empty());
        assert_eq!(d.get(OTHER).unwrap().kind, Kind::Application);
        assert_eq!(d.ignored(), 4);
        // but another registry itself is an application
        let o = Origin {
            service_type: ServiceType::Registry,
            ..at(other, other, false, 4)
        };
        d.mam(&o, mam(other));
        assert_eq!(d.get(other).unwrap().service_type, ServiceType::Registry);
    }

    /// The data logger: the last value per publisher, Source and Filter;
    /// at most [`DATA_SETS`], the one updated longest ago dropped; a
    /// Payload longer than [`DATA_MAX`] not kept; own messages ignored.
    #[test]
    fn data_logger() {
        let mut d = Directory::new(ME);
        let v = |x: i64| serde_json::json!({ "Value": x });
        d.data(&at(APP, PUMP, false, 1), Some("Level".to_owned()), 7, v(1));
        d.data(&at(APP, PUMP, false, 2), Some("Level".to_owned()), 7, v(2));
        d.data(&at(APP, PUMP, false, 3), Some("Flow".to_owned()), 8, v(3));
        d.data(&at(ME, ME, false, 4), None, 9, v(4));
        let sets: Vec<_> = d.data_sets().collect();
        assert_eq!(sets.len(), 2);
        let level = sets
            .iter()
            .find(|r| r.filter.as_deref() == Some("Level"))
            .unwrap();
        assert_eq!((level.seq, level.at, level.data_set_writer_id), (2, 2, 7));
        assert_eq!(level.payload, Some(v(2)));
        assert_eq!(level.publisher, APP);
        assert_eq!(level.source, PUMP);
        assert_eq!(d.ignored(), 1);

        let big = serde_json::json!({ "Blob": "x".repeat(DATA_MAX) });
        d.data(&at(APP, APP, false, 5), None, 1, big);
        let blob = d.data_sets().find(|r| r.source == APP).unwrap();
        assert_eq!(blob.payload, None);

        for i in 0..DATA_SETS {
            d.data(&at(APP, APP, false, 6), Some(format!("S{i}")), 2, v(0));
        }
        assert_eq!(d.data_sets().count(), DATA_SETS);
        // the three oldest (Level, Flow, the blob) are dropped
        assert!(
            d.data_sets()
                .all(|r| r.filter.as_deref().is_some_and(|f| f.starts_with('S')))
        );
    }

    /// A Close of an application never seen online is recorded offline.
    #[test]
    fn close_of_an_unknown_application() {
        let mut d = Directory::new(ME);
        let fx = d.health(&at(APP, APP, false, 1), health(HealthState::Normal, 0));
        assert!(fx.is_empty(), "{fx:?}");
        assert_eq!(state(&d, APP), Availability::OfflineGraceful);
        assert!(!d.missing(&Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want: Want::Mam
        }));
    }

    fn subjects(resources: &[Resource]) -> Vec<Subject> {
        resources
            .iter()
            .map(|r| Subject::Resource(*r))
            .chain([Subject::Service(Service::NewDataSetWriterId)])
            .collect()
    }

    /// The Profile of an application of Level 3 (as the SDK's).
    fn l3() -> Vec<Subject> {
        subjects(&[
            Resource::Mam,
            Resource::Health,
            Resource::Config,
            Resource::Data,
            Resource::Metadata,
            Resource::ReferenceDesignation,
            Resource::Event,
            Resource::Profile,
            Resource::PublicationList,
            Resource::SubscriptionList,
        ])
    }

    fn event(number: u32) -> Event {
        serde_json::from_value(serde_json::json!({
            "Number": number, "Category": "CAT_STATUS_1", "Description": "d"
        }))
        .unwrap()
    }

    fn publication(resource: Resource, source: &str, id: u16) -> PublicationEntry {
        serde_json::from_value(serde_json::json!({
            "Resource": resource.as_str(), "Source": source, "DataSetWriterId": id
        }))
        .unwrap()
    }

    fn subscription(topic: &str) -> SubscriptionEntry {
        serde_json::from_value(serde_json::json!({ "TopicPath": topic })).unwrap()
    }

    fn ask(d: &mut Directory, want: Want, answer: Answer, lists: Lists) {
        let f = Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want,
        };
        d.asked(&f, answer, lists);
    }

    fn online_app(d: &mut Directory) {
        d.mam(&at(APP, APP, false, 1), mam(APP));
        d.health(&at(APP, APP, false, 1), normal());
    }

    /// Rule 6 and `missing`: everything is asked once per online period;
    /// a `Get` without answer is not repeated for the resource, MAM and
    /// Health are while they lack.
    #[test]
    fn asked_once_per_online_period() {
        let mut d = Directory::new(ME);
        online_app(&mut d);
        let f = |want| Fetch {
            service_type: ServiceType::Aggregation,
            app: APP.to_owned(),
            want,
        };
        for w in Want::ALL {
            assert!(d.missing(&f(w)), "{w:?}");
        }
        ask(&mut d, Want::Profile, Answer::Timeout, Lists::None);
        assert!(!d.missing(&f(Want::Profile)));
        ask(&mut d, Want::Health, Answer::Answered, Lists::None);
        assert!(!d.missing(&f(Want::Health)));
        // a device lacks its Health: asked again
        d.mam(&at(APP, PUMP, false, 2), mam(PUMP));
        assert!(d.missing(&f(Want::Health)));
        // a later answer counts, a later failure does not undo it
        ask(&mut d, Want::Profile, Answer::Answered, Lists::None);
        ask(&mut d, Want::Profile, Answer::Timeout, Lists::None);
        assert_eq!(
            d.get(APP).unwrap().answers.get(&Want::Profile),
            Some(&Answer::Answered)
        );
        // the next Birth: asked again
        d.health(&at(APP, APP, false, 3), health(HealthState::Normal, 0));
        let fx = d.mam(&at(APP, APP, false, 4), mam(APP));
        assert_eq!(fetches(&fx), Want::ALL);
        assert!(d.get(APP).unwrap().answers.is_empty());
        assert!(d.missing(&f(Want::Profile)));
    }

    /// Profile, Events, PublicationList and SubscriptionList; the
    /// publisher relation.
    #[test]
    fn profile_events_and_lists() {
        let mut d = Directory::new(ME);
        online_app(&mut d);
        d.mam(&at(APP, PUMP, false, 2), mam(PUMP));
        d.profile(&at(APP, APP, true, 3), l3());
        d.profile(&at(APP, PUMP, false, 3), subjects(&[Resource::Mam]));
        // of an unknown entry or the wrong publisher: dropped
        d.profile(&at(APP, OTHER, false, 3), l3());
        d.profile(&at(OTHER, PUMP, false, 3), l3());
        assert_eq!(d.get(APP).unwrap().profile, Some(l3()));
        assert_eq!(
            d.get(PUMP).unwrap().profile,
            Some(subjects(&[Resource::Mam]))
        );
        assert!(d.get(OTHER).is_none());
        let devices: Vec<&str> = d.devices(APP).map(|e| e.il.as_str()).collect();
        assert_eq!(devices, [PUMP]);

        // the Event trail of all participants, bounded, own ones ignored
        d.set_limits(Limits {
            event_trail: 2,
            ..Limits::default()
        });
        d.event(
            &at(APP, APP, false, 4),
            Some("CAT_STATUS_1/Good".into()),
            event(0),
        );
        d.event(&at(ME, ME, false, 4), None, event(1));
        d.event(&at(APP, PUMP, false, 5), None, event(2));
        d.event(&at(OTHER, OTHER, false, 6), None, event(3));
        let trail: Vec<(u64, u64, &str, u32)> = d
            .events()
            .map(|r| (r.seq, r.at, r.source.as_str(), r.event.number))
            .collect();
        // numbered from 1, the own one not counted, numbers kept when cut
        assert_eq!(trail, [(2, 5, PUMP, 2), (3, 6, OTHER, 3)]);

        // lists: entries are put in by key; the complete answer to the
        // registry's Get replaces them
        d.publications(
            &at(APP, APP, false, 7),
            vec![
                publication(Resource::Mam, APP, 11),
                publication(Resource::Mam, PUMP, 12),
            ],
        );
        d.publications(
            &at(APP, PUMP, false, 8),
            vec![publication(Resource::Mam, PUMP, 13)],
        );
        let ids = |d: &Directory| -> Vec<u16> {
            d.get(APP)
                .unwrap()
                .publications
                .iter()
                .map(|p| p.data_set_writer_id.get())
                .collect()
        };
        assert_eq!(ids(&d), [11, 13]);
        ask(
            &mut d,
            Want::PublicationList,
            Answer::Answered,
            Lists::Publications(vec![publication(Resource::Health, APP, 14)]),
        );
        assert_eq!(ids(&d), [14]);
        d.subscriptions(
            &at(APP, APP, false, 9),
            vec![subscription("Oi4v2/+/+/Pub/MAM/#")],
        );
        d.subscriptions(
            &at(APP, APP, false, 9),
            vec![subscription("Oi4v2/+/+/Pub/MAM/#"), subscription("t")],
        );
        assert_eq!(d.get(APP).unwrap().subscriptions.len(), 2);
        ask(
            &mut d,
            Want::SubscriptionList,
            Answer::Answered,
            Lists::Subscriptions(Vec::new()),
        );
        assert!(d.get(APP).unwrap().subscriptions.is_empty());
        // lists of a device's publisher only
        d.subscriptions(&at(PUMP, PUMP, false, 9), vec![subscription("t")]);
        assert!(d.get(PUMP).unwrap().subscriptions.is_empty());
    }

    /// The observed level (REQ-CMP-013): Level 1 by the publications,
    /// Level 2 by the answers to Get MAM and Health, Level 3 by the
    /// Profile and the lists; a device needs no lists.
    #[test]
    fn observed_level() {
        let mut d = Directory::new(ME);
        d.mam(&at(APP, APP, false, 1), mam(APP));
        let o = d.observed(APP).unwrap();
        assert_eq!((o.level, o.missing), (0, vec!["REQ-CMP-014"]));
        d.health(&at(APP, APP, false, 1), normal());
        let o = d.observed(APP).unwrap();
        assert_eq!(
            (o.level, o.missing),
            (1, vec!["REQ-CMP-015", "REQ-CMP-017"])
        );
        // an answer by the raw items or the registry's Get
        d.mam(&at(APP, APP, true, 2), mam(APP));
        assert_eq!(d.observed(APP).unwrap().missing, ["REQ-CMP-017"]);
        ask(&mut d, Want::Health, Answer::Answered, Lists::None);
        let o = d.observed(APP).unwrap();
        assert_eq!(o.level, 2);
        assert_eq!(
            o.missing,
            [
                "REQ-CMP-018",
                "REQ-CMP-019",
                "REQ-CMP-020",
                "REQ-CMP-034",
                "REQ-CMP-035",
                "REQ-CMP-036",
                "REQ-CMP-037",
                "REQ-CMP-038",
                "REQ-CMP-039"
            ]
        );
        // a Profile without ReferenceDesignation, published, not answered
        let mut profile = l3();
        profile.retain(|s| *s != Subject::Resource(Resource::ReferenceDesignation));
        d.profile(&at(APP, APP, false, 3), profile);
        assert_eq!(
            d.observed(APP).unwrap().missing,
            ["REQ-CMP-018", "REQ-CMP-019", "REQ-CMP-020", "REQ-CMP-039"]
        );
        d.profile(&at(APP, APP, true, 4), l3());
        ask(
            &mut d,
            Want::PublicationList,
            Answer::Answered,
            Lists::default(),
        );
        assert_eq!(d.observed(APP).unwrap().missing, ["REQ-CMP-039"]);
        ask(&mut d, Want::SubscriptionList, Answer::Timeout, Lists::None);
        assert_eq!(d.observed(APP).unwrap().level, 2);
        ask(
            &mut d,
            Want::SubscriptionList,
            Answer::Answered,
            Lists::default(),
        );
        let o = d.observed(APP).unwrap();
        assert_eq!((o.level, o.missing), (3, vec![]));

        // a device: its MAM, Health and Profile in answers of its publisher
        d.mam(&at(APP, PUMP, true, 5), mam(PUMP));
        d.health(&at(APP, PUMP, true, 5), normal());
        assert_eq!(d.observed(PUMP).unwrap().level, 2);
        let mut device = l3();
        device.retain(|s| {
            !matches!(
                s,
                Subject::Resource(Resource::PublicationList | Resource::SubscriptionList)
                    | Subject::Service(_)
            )
        });
        d.profile(&at(APP, PUMP, true, 6), device);
        assert_eq!(d.observed(PUMP).unwrap().level, 3);

        // the next Birth: answers from before do not count
        d.health(&at(APP, APP, false, 7), health(HealthState::Failure, 0));
        d.mam(&at(APP, APP, false, 8), mam(APP));
        d.health(&at(APP, APP, false, 8), normal());
        assert_eq!(d.observed(APP).unwrap().level, 1);
        assert_eq!(d.observed(PUMP).unwrap().level, 1);
        assert!(d.observed(OTHER).is_none());
    }

    /// The Health history keeps the changes only, bounded; a smaller bound
    /// cuts it at once.
    #[test]
    fn health_history() {
        let mut d = Directory::new(ME);
        online_app(&mut d);
        d.health(&at(APP, APP, false, 2), normal());
        d.health(&at(APP, APP, false, 3), health(HealthState::OffSpec, 50));
        d.health(&at(APP, APP, false, 4), health(HealthState::OffSpec, 40));
        d.health(&at(APP, APP, false, 5), health(HealthState::OffSpec, 40));
        let times = |d: &Directory| -> Vec<u64> {
            d.get(APP)
                .unwrap()
                .health_history
                .iter()
                .map(|(t, _)| *t)
                .collect()
        };
        assert_eq!(times(&d), [1, 3, 4]);
        d.set_limits(Limits {
            health_history: 2,
            ..Limits::default()
        });
        assert_eq!(times(&d), [3, 4]);
        d.health(&at(APP, APP, false, 6), normal());
        assert_eq!(times(&d), [4, 6]);
        assert_eq!(d.limits().health_history, 2);
    }

    /// Conformity per participant: counted, the last violations bounded,
    /// own messages not.
    #[test]
    fn conformity() {
        let mut d = Directory::new(ME);
        let v = |at: u64| Violation {
            at,
            topic: "t".into(),
            reqs: vec!["REQ-MSG-003".into()],
            message: "m".into(),
        };
        d.set_limits(Limits {
            violation_trail: 2,
            ..Limits::default()
        });
        d.checked(APP, None);
        for at in 1..=3 {
            d.checked(APP, Some(v(at)));
        }
        d.checked(ME, Some(v(9)));
        let c = d.conformity(APP).unwrap();
        assert_eq!((c.messages, c.violations), (4, 3));
        assert_eq!(c.last.iter().map(|v| v.at).collect::<Vec<_>>(), [2, 3]);
        assert!(d.conformity(ME).is_none());
        d.set_limits(Limits {
            violation_trail: 1,
            ..Limits::default()
        });
        assert_eq!(d.conformity(APP).unwrap().last.len(), 1);
    }

    /// C-113 RR-1: a device entry another publisher created about the IL
    /// of an application (squatting) is taken back by the application's
    /// own MAM or Health: the forged MAM and Health are dropped and later
    /// device messages about it are ignored.
    #[test]
    fn device_cannot_squat_an_application() {
        for own_mam in [true, false] {
            let mut d = Directory::new(ME);
            d.mam(&at(OTHER, OTHER, false, 1), mam(OTHER));
            d.health(&at(OTHER, OTHER, false, 1), normal());
            d.mam(&at(OTHER, APP, false, 2), mam(APP));
            d.health(&at(OTHER, APP, false, 2), health(HealthState::Failure, 7));
            assert_eq!(d.get(APP).unwrap().kind, Kind::Device);
            assert!(d.get(APP).unwrap().available(), "listed as a device");

            let fx = if own_mam {
                d.mam(&at(APP, APP, false, 3), mam(APP))
            } else {
                d.health(&at(APP, APP, false, 3), normal())
            };
            let e = d.get(APP).unwrap();
            assert_eq!((e.kind, e.publisher.as_str()), (Kind::Application, APP));
            assert_eq!(e.availability, Availability::Online);
            assert_eq!(e.mam.is_some(), own_mam, "the forged MAM is dropped");
            assert_eq!(e.health.is_some(), !own_mam, "the forged Health is dropped");
            assert!(
                e.health_history
                    .iter()
                    .all(|(_, h)| h.health == HealthState::Normal)
            );
            assert_eq!(unlisted(&fx), [APP], "the forgery is no longer offered");
            assert_eq!(fetches(&fx), Want::ALL, "rule 2: a first sighting");
            assert_eq!(d.devices(OTHER).count(), 0);

            let ignored = d.ignored();
            let mut forged = mam(APP);
            forged.serial_number = "forged".into();
            assert!(d.mam(&at(OTHER, APP, false, 4), forged).is_empty());
            assert!(d.health(&at(OTHER, APP, false, 4), normal()).is_empty());
            assert_eq!(d.ignored(), ignored + 2);
            assert_eq!(d.get(APP).unwrap().publisher, APP);
            assert_ne!(
                d.get(APP)
                    .unwrap()
                    .mam
                    .as_ref()
                    .map(|m| m.serial_number.as_str()),
                Some("forged")
            );
        }
    }

    /// C-113 RR-1: a device message whose Source is the AppId of a
    /// participant seen on the bus is no device message (the conformity
    /// view has seen it publish under its own AppId).
    #[test]
    fn a_participant_is_no_device() {
        let mut d = Directory::new(ME);
        d.checked(OTHER, None);
        assert!(d.mam(&at(APP, OTHER, false, 1), mam(OTHER)).is_empty());
        assert!(d.health(&at(APP, OTHER, false, 1), normal()).is_empty());
        assert!(d.get(OTHER).is_none());
        assert_eq!(d.ignored(), 2);
    }

    /// C-113 RR-1: the device of an online publisher is not taken over by
    /// another publisher; after its publisher left it may be.
    #[test]
    fn device_of_an_online_publisher_stays() {
        let mut d = Directory::new(ME);
        online_app(&mut d);
        d.mam(&at(APP, PUMP, false, 2), mam(PUMP));
        d.health(&at(OTHER, OTHER, false, 2), normal());
        let mut forged = mam(PUMP);
        forged.serial_number = "forged".into();
        assert!(d.mam(&at(OTHER, PUMP, false, 3), forged).is_empty());
        assert!(d.health(&at(OTHER, PUMP, false, 3), normal()).is_empty());
        assert_eq!(d.ignored(), 2);
        let e = d.get(PUMP).unwrap();
        assert_eq!(e.publisher, APP);
        assert_eq!(e.mam, Some(mam(PUMP)));
        assert!(e.health.is_none());

        d.health(&at(APP, APP, false, 4), health(HealthState::Normal, 0));
        d.mam(&at(OTHER, PUMP, false, 5), mam(PUMP));
        assert_eq!(d.get(PUMP).unwrap().publisher, OTHER);
    }

    fn nth(i: usize) -> String {
        format!("vendor.com/App/A-1/{i}")
    }

    /// C-113 RR-3: at most [`ENTRIES`] entries; when full, the offline
    /// entry seen longest ago gives way, an online one never: then the
    /// new asset is ignored.
    #[test]
    fn entries_are_bounded() {
        let mut d = Directory::new(ME);
        for i in 0..ENTRIES {
            let il = nth(i);
            d.health(&at(&il, &il, false, 1), normal());
        }
        assert_eq!(d.entries().count(), ENTRIES);
        let extra = nth(ENTRIES);
        assert!(d.health(&at(&extra, &extra, false, 2), normal()).is_empty());
        assert!(
            d.mam(&at(&nth(0), &extra, false, 2), mam(&extra))
                .is_empty()
        );
        assert!(d.get(&extra).is_none());
        assert_eq!(d.ignored(), 2);
        assert_eq!(d.entries().count(), ENTRIES);

        // two leave; the one seen longest ago gives way first
        let (a, b) = (nth(7), nth(3));
        d.health(&at(&a, &a, false, 3), health(HealthState::Normal, 0));
        d.health(&at(&b, &b, false, 4), health(HealthState::Failure, 0));
        d.health(&at(&extra, &extra, false, 5), normal());
        assert!(d.get(&extra).is_some());
        assert!(d.get(&a).is_none());
        assert!(d.get(&b).is_some());
        let device = nth(ENTRIES + 1);
        d.mam(&at(&extra, &device, false, 6), mam(&device));
        assert!(d.get(&b).is_none());
        assert_eq!(d.get(&device).unwrap().kind, Kind::Device);
        assert_eq!(d.entries().count(), ENTRIES);
    }

    /// C-113 RR-3: a MAM, Health, Profile or Event whose JSON text is
    /// longer than [`VALUE_MAX`] is not kept (counted as ignored).
    #[test]
    fn oversized_values_are_not_kept() {
        let mut d = Directory::new(ME);
        let mut big = mam(APP);
        big.hardware_revision = "x".repeat(VALUE_MAX);
        assert!(d.mam(&at(APP, APP, false, 1), big).is_empty());
        assert!(d.get(APP).is_none());
        let detail =
            serde_json::json!({ "Health": "NORMAL_0", "Description": "x".repeat(VALUE_MAX) });
        let big: Health = serde_json::from_value(serde_json::json!({
            "Health": "NORMAL_0", "HealthScore": 100, "Details": [detail]
        }))
        .unwrap();
        assert!(d.health(&at(APP, APP, false, 1), big).is_empty());
        assert!(d.get(APP).is_none());
        assert_eq!(d.ignored(), 2);

        online_app(&mut d);
        let profile = vec![Subject::Resource(Resource::Mam); VALUE_MAX / 4];
        d.profile(&at(APP, APP, false, 2), profile);
        assert!(d.get(APP).unwrap().profile.is_none());
        let mut ev = event(1);
        ev.description = Some("x".repeat(VALUE_MAX));
        d.event(&at(APP, APP, false, 2), None, ev);
        assert_eq!(d.events().count(), 0);
        let mut p = publication(Resource::Mam, APP, 11);
        p.filter = Some("x".repeat(VALUE_MAX));
        d.publications(&at(APP, APP, false, 2), vec![p.clone()]);
        ask(
            &mut d,
            Want::PublicationList,
            Answer::Answered,
            Lists::Publications(vec![p, publication(Resource::Mam, APP, 12)]),
        );
        assert_eq!(d.get(APP).unwrap().publications.len(), 1);
        assert_eq!(d.ignored(), 6);
    }

    /// C-113 RR-3: at most [`LIST_ENTRIES`] PublicationList and
    /// SubscriptionList entries over all applications.
    #[test]
    fn lists_are_bounded() {
        let mut d = Directory::new(ME);
        online_app(&mut d);
        d.mam(&at(OTHER, OTHER, false, 1), mam(OTHER));
        let subs = |n: usize| (0..n).map(|i| subscription(&format!("t/{i}"))).collect();
        ask(
            &mut d,
            Want::SubscriptionList,
            Answer::Answered,
            Lists::Subscriptions(subs(LIST_ENTRIES + 5)),
        );
        assert_eq!(d.get(APP).unwrap().subscriptions.len(), LIST_ENTRIES);
        d.subscriptions(&at(OTHER, OTHER, false, 2), vec![subscription("u")]);
        assert!(d.get(OTHER).unwrap().subscriptions.is_empty());
        // replacing a list frees its room
        ask(
            &mut d,
            Want::SubscriptionList,
            Answer::Answered,
            Lists::Subscriptions(subs(1)),
        );
        d.subscriptions(&at(OTHER, OTHER, false, 3), vec![subscription("u")]);
        assert_eq!(d.get(OTHER).unwrap().subscriptions.len(), 1);
        // an entry with a known key replaces it even when full
        ask(
            &mut d,
            Want::SubscriptionList,
            Answer::Answered,
            Lists::Subscriptions(subs(LIST_ENTRIES - 1)),
        );
        d.subscriptions(&at(APP, APP, false, 4), vec![subscription("t/0")]);
        assert_eq!(d.get(APP).unwrap().subscriptions.len(), LIST_ENTRIES - 1);
    }

    /// C-113 RR-3: at most [`ENTRIES`] participants in the conformity view;
    /// the one checked longest ago gives way unless it is online; the
    /// texts of a violation are bounded.
    #[test]
    fn conformity_is_bounded() {
        let mut d = Directory::new(ME);
        online_app(&mut d);
        d.checked(APP, None);
        for i in 0..=ENTRIES {
            d.checked(&nth(i), None);
        }
        assert_eq!(d.conformity.len(), ENTRIES);
        assert!(d.conformity(APP).is_some(), "online: kept");
        assert!(d.conformity(&nth(0)).is_none());
        assert!(d.conformity(&nth(ENTRIES)).is_some());

        d.checked(
            APP,
            Some(Violation {
                at: 1,
                topic: "t".repeat(TEXT_MAX + 1),
                reqs: Vec::new(),
                message: "m".repeat(TEXT_MAX + 1),
            }),
        );
        let v = d.conformity(APP).unwrap().last.back().unwrap();
        assert_eq!((v.topic.len(), v.message.len()), (TEXT_MAX, TEXT_MAX));
    }

    /// C-113 RR-3: the Health history keeps state and score, not the
    /// details (bounded per change).
    #[test]
    fn health_history_without_details() {
        let mut d = Directory::new(ME);
        let h: Health = serde_json::from_value(serde_json::json!({
            "Health": "MAINTENANCE_REQUIRED_4", "HealthScore": 80,
            "Details": [{ "Health": "MAINTENANCE_REQUIRED_4", "Description": "filter" }]
        }))
        .unwrap();
        d.health(&at(APP, APP, false, 1), h.clone());
        let e = d.get(APP).unwrap();
        assert_eq!(e.health, Some(h));
        let (_, kept) = e.health_history.back().unwrap();
        assert_eq!(kept.health, HealthState::MaintenanceRequired);
        assert_eq!(kept.health_score, Some(80));
        assert!(kept.details.is_none());
    }
}
