//! Tests of the API documents (ADR-0029 §7, §8, §11, A-385): `api/asyncapi.json`
//! is valid against the vendored AsyncAPI 3.1.0 JSON Schema and describes
//! exactly the MQTT interface of the registry – on its own AppId every
//! topic form of MG 7/9 (the SDK at Messaging Level 3, including the
//! Registry services of MG A1), the subscriptions and the `Get`s it uses
//! to collect – with the D1 topic schemas as payloads. The Go test
//! `TestD7Level3` checks the topics of the running registry against it.
//!
//! `api/openapi.json` is valid against the vendored OpenAPI 3.2 JSON
//! Schema, its paths are the router of [`crate::api`] with `GET` only, and
//! its component schemas (with the D1 schemas of the MG payloads) describe
//! the views and stream messages of [`crate::api`]. The Go tests of the
//! HTTP side check the running registry against it.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use oec::ServiceType;
use oec_core::topic::{Form, Method, Presence, Resource, Service, Subject};
use serde_json::Value;

use crate::api::{self, Route, Stream};
use crate::bus::COLLECTED;
use crate::directory::Want;

const D1: &str = "https://schemas.openindustry4.com/oec/v2/topics/";

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn asyncapi() -> Value {
    json(&root().join("api/asyncapi.json"))
}

/// Resolves a local `$ref` (`#/a/b`) of `doc`.
fn resolve<'a>(doc: &'a Value, reference: &Value) -> &'a Value {
    let r = reference["$ref"].as_str().expect("a $ref");
    let pointer = r
        .strip_prefix('#')
        .unwrap_or_else(|| panic!("not local: {r}"));
    doc.pointer(pointer)
        .unwrap_or_else(|| panic!("unresolved: {r}"))
}

#[test]
fn asyncapi_is_valid() {
    let meta = json(&root().join("api/meta/asyncapi-3.1.0.schema.json"));
    let validator = jsonschema::validator_for(&meta).expect("the meta-schema compiles");
    let doc = asyncapi();
    let errors: Vec<String> = validator
        .iter_errors(&doc)
        .map(|e| format!("{} at {}", e, e.instance_path()))
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
    // a broken document is rejected (the validator is not vacuous)
    let mut broken = doc.clone();
    broken["channels"]["getMam"]["address"] = Value::from(42);
    assert!(!validator.is_valid(&broken));
    assert_eq!(doc["info"]["version"], env!("CARGO_PKG_VERSION"));
}

/// The topic forms of a method and subject (REQ-TOP-013): with Source,
/// with Filter.
fn forms(method: Method, subject: Subject) -> Vec<(bool, bool)> {
    let Some(form) = Form::of(method, subject) else {
        return Vec::new();
    };
    let admits = |p: Presence| match p {
        Presence::Forbidden => vec![false],
        Presence::Optional => vec![false, true],
        Presence::Required => vec![true],
    };
    let mut out = Vec::new();
    for source in admits(form.source) {
        for filter in admits(form.filter) {
            if source || !filter {
                out.push((source, filter));
            }
        }
    }
    out
}

fn subjects() -> impl Iterator<Item = Subject> {
    Resource::ALL
        .iter()
        .map(|r| Subject::Resource(*r))
        .chain(Service::ALL.iter().map(|s| Subject::Service(*s)))
}

type Channel = (String, String, bool, bool);

/// The channels: (method, resource, with Source, with Filter), own and of
/// others.
#[test]
fn asyncapi_channels_are_the_interface() {
    let doc = asyncapi();
    let mut own: BTreeSet<Channel> = BTreeSet::new();
    let mut others: BTreeSet<Channel> = BTreeSet::new();
    for (name, channel) in doc["channels"].as_object().expect("channels") {
        let address = channel["address"].as_str().expect("address");
        let levels: Vec<&str> = address.split('/').collect();
        assert_eq!(levels[0], "Oi4v2", "{name}");
        // the parameters are exactly the {…} levels of the address
        let used: BTreeSet<&str> = levels
            .iter()
            .filter_map(|l| l.strip_prefix('{').and_then(|l| l.strip_suffix('}')))
            .collect();
        let declared: BTreeSet<&str> = channel["parameters"]
            .as_object()
            .map(|p| p.keys().map(String::as_str).collect())
            .unwrap_or_default();
        assert_eq!(used, declared, "{name}");
        let (method, resource) = (levels[3], levels[4]);
        let (source, filter) = match &levels[5..] {
            [] => (false, false),
            ["{source}"] => (true, false),
            ["{source}", "{filter}"] => (true, true),
            rest => panic!("{name}: {rest:?}"),
        };
        let key = (method.to_owned(), resource.to_owned(), source, filter);
        match (levels[1], levels[2]) {
            ("Registry", "{appId}") => assert!(own.insert(key), "{name}"),
            ("{serviceType}", "{otherAppId}") => {
                let names: BTreeSet<&str> = channel["parameters"]["serviceType"]["enum"]
                    .as_array()
                    .expect("enum")
                    .iter()
                    .filter_map(Value::as_str)
                    .collect();
                let all: BTreeSet<&str> = ServiceType::ALL.iter().map(|s| s.as_str()).collect();
                assert_eq!(names, all, "{name}");
                assert!(others.insert(key), "{name}");
            }
            other => panic!("{name}: {other:?}"),
        }
        // one message, the D1 schema of the topic
        let messages = channel["messages"].as_object().expect("messages");
        assert_eq!(messages.len(), 1, "{name}");
        let message = resolve(&doc, messages.values().next().expect("one"));
        let file = format!(
            "{}-{}.schema.json",
            method.to_lowercase(),
            resource.to_lowercase()
        );
        assert_eq!(message["payload"]["$ref"], format!("{D1}{file}"), "{name}");
        let schema = json(&root().join("../schema/v2/topics").join(&file));
        assert_eq!(schema["$id"], format!("{D1}{file}"), "{name}");
    }
    // own: every form of MG 7/9 – the SDK serves all of them at Level 3,
    // MAM and Health with and without Source being the Registry services of
    // MG A1 (REQ-REG-002)
    let mut want = BTreeSet::new();
    for method in Method::ALL {
        for subject in subjects() {
            for (source, filter) in forms(*method, subject) {
                want.insert((
                    method.as_str().to_owned(),
                    subject.to_string(),
                    source,
                    filter,
                ));
            }
        }
    }
    assert_eq!(own, want);
    // collecting: every form of Pub of the collected resources (subscribed
    // with #), Get without Source of what the registry asks for
    let mut want = BTreeSet::new();
    for r in COLLECTED {
        let subject = Subject::Resource(r);
        for (source, filter) in forms(Method::Pub, subject) {
            want.insert(("Pub".to_owned(), subject.to_string(), source, filter));
        }
    }
    for w in Want::ALL {
        want.insert((
            "Get".to_owned(),
            w.resource().as_str().to_owned(),
            false,
            false,
        ));
    }
    assert_eq!(others, want);
}

/// Every operation points to a channel of the document and its messages;
/// the registry receives requests to itself and publications of others,
/// and sends its publications, its replies and `Get`s to others only
/// (ADR-0008); a `Get` is answered by `Pub`, a `Call` by `Reply`.
#[test]
fn asyncapi_operations_are_read_only() {
    let doc = asyncapi();
    let mut used = BTreeSet::new();
    for (name, op) in doc["operations"].as_object().expect("operations") {
        let channel = resolve(&doc, &op["channel"]);
        let address = channel["address"].as_str().expect("address");
        for m in op["messages"].as_array().expect("messages") {
            resolve(&doc, m);
        }
        let levels: Vec<&str> = address.split('/').collect();
        let own = levels[1] == "Registry";
        let action = op["action"].as_str().expect("action");
        match (own, levels[3], action) {
            (true, "Get" | "Set" | "Del" | "Call", "receive")
            | (false, "Pub", "receive")
            | (true, "Pub" | "Reply", "send")
            | (false, "Get", "send") => {
                used.insert(address);
            }
            other => panic!("{name}: {other:?}"),
        }
        if let Some(reply) = op.get("reply") {
            let answer = match levels[3] {
                "Get" if own => "/Pub/",
                "Call" if own => "/Reply/",
                _ => panic!("{name}: a reply"),
            };
            let to = resolve(&doc, &reply["channel"])["address"]
                .as_str()
                .expect("address");
            assert_eq!(
                to,
                address.replacen(&format!("/{}/", levels[3]), answer, 1),
                "{name}"
            );
            for m in reply["messages"].as_array().expect("messages") {
                resolve(&doc, m);
            }
        } else {
            assert!(
                !(own && matches!(levels[3], "Get" | "Call")),
                "{name}: no reply"
            );
        }
    }
    // every channel has its operation
    for channel in doc["channels"].as_object().expect("channels").values() {
        let address = channel["address"].as_str().expect("address");
        assert!(used.contains(address), "{address}");
    }
}

fn openapi() -> Value {
    json(&root().join("api/openapi.json"))
}

#[test]
fn openapi_is_valid() {
    let meta = json(&root().join("api/meta/openapi-3.2-2026-08-30.schema.json"));
    let validator = jsonschema::validator_for(&meta).expect("the meta-schema compiles");
    let doc = openapi();
    let errors: Vec<String> = validator
        .iter_errors(&doc)
        .map(|e| format!("{} at {}", e, e.instance_path()))
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
    // a broken document is rejected (the validator is not vacuous)
    let mut broken = doc.clone();
    broken["paths"]["/api/events"]["get"]["responses"]["200"] = Value::from(42);
    assert!(!validator.is_valid(&broken));
    assert_eq!(doc["openapi"], "3.2.0");
    assert_eq!(doc["info"]["version"], env!("CARGO_PKG_VERSION"));
    // the document served is this one
    assert_eq!(serde_json::from_str::<Value>(api::OPENAPI).ok(), Some(doc));
}

/// The paths are those of the router, each with `GET` only (read-only,
/// ADR-0008), and every `$ref` of the document resolves.
#[test]
fn openapi_paths_are_the_router() {
    let doc = openapi();
    let paths = doc["paths"].as_object().expect("paths");
    let documented: BTreeSet<&str> = paths.keys().map(String::as_str).collect();
    let routed: BTreeSet<&str> = Route::PATHS.into_iter().collect();
    assert_eq!(documented, routed);
    for (path, item) in paths {
        let methods: Vec<&String> = item.as_object().expect("path item").keys().collect();
        assert_eq!(methods, ["get"], "{path}");
        let get = &item["get"];
        for code in ["200", "403", "405"] {
            assert!(get["responses"].get(code).is_some(), "{path} {code}");
        }
        // an example path of the template is routed to it, on both ports
        let example = path.replace("{il}", "vendor.com%2FPump%2FP-1%2F0815");
        for ui in [true, false] {
            let r = api::route(&example, ui).unwrap_or_else(|| panic!("{example}"));
            assert_eq!(r.template(), Some(path.as_str()));
        }
    }
    assert_eq!(api::route("/", false), None);
    let mut refs = Vec::new();
    collect_refs(&doc, &mut refs);
    assert!(!refs.is_empty());
    for r in refs {
        if let Some(pointer) = r.strip_prefix('#') {
            assert!(doc.pointer(pointer).is_some(), "unresolved: {r}");
        } else {
            let (file, pointer) = r.split_once('#').unwrap_or((&r, ""));
            let rel = file
                .strip_prefix("https://schemas.openindustry4.com/oec/v2/")
                .unwrap_or_else(|| panic!("not D1: {r}"));
            let schema = json(&root().join("../schema/v2").join(rel));
            assert_eq!(schema["$id"], file, "{r}");
            assert!(schema.pointer(pointer).is_some(), "unresolved: {r}");
        }
    }
}

fn collect_refs(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            if let Some(Value::String(r)) = m.get("$ref") {
                out.push(r.clone());
            }
            m.values().for_each(|v| collect_refs(v, out));
        }
        Value::Array(a) => a.iter().for_each(|v| collect_refs(v, out)),
        _ => {}
    }
}

/// The D1 schema tree by `$id`.
fn d1() -> Vec<(String, Value)> {
    fn walk(dir: &Path, out: &mut Vec<(String, Value)>) {
        for e in std::fs::read_dir(dir).expect("D1") {
            let path = e.expect("D1").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|x| x == "json") {
                let doc = json(&path);
                let id = doc["$id"].as_str().expect("$id").to_owned();
                out.push((id, doc));
            }
        }
    }
    let mut out = Vec::new();
    walk(&root().join("../schema/v2"), &mut out);
    out
}

/// The component schemas of `api/openapi.json` (with the D1 schemas)
/// describe the views and stream messages; an unknown member is refused.
#[test]
fn openapi_schemas_are_the_views() {
    use crate::api::tests::{APP, PUMP, fixture};
    let registry = jsonschema::Registry::new()
        .extend(d1())
        .and_then(jsonschema::RegistryBuilder::prepare)
        .expect("the D1 tree");
    let doc = openapi();
    let validator = |name: &str| {
        let schema = serde_json::json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://registry.invalid/openapi.json",
            "components": doc["components"].clone(),
            "$ref": format!("#/components/schemas/{name}"),
        });
        jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .with_registry(&registry)
            .build(&schema)
            .unwrap_or_else(|e| panic!("{name}: {e}"))
    };
    let check = |name: &str, instance: &Value| {
        let v = validator(name);
        let errors: Vec<String> = v
            .iter_errors(instance)
            .map(|e| format!("{} at {}", e, e.instance_path()))
            .collect();
        assert!(errors.is_empty(), "{name}: {errors:#?}\n{instance:#}");
        let mut extra = instance.clone();
        extra["unknown"] = Value::Null;
        assert!(!v.is_valid(&extra), "{name}: an unknown member");
    };
    let mut d = fixture();
    check("Assets", &api::assets(&d, 7));
    check("Asset", &api::asset(&d, APP).expect("the application"));
    check("Asset", &api::asset(&d, PUMP).expect("the device"));
    check("Events", &api::events(&d));
    check("Data", &api::data(&d));
    check("Error", &serde_json::json!({ "error": "not found" }));
    let mut stream = Stream::default();
    let snapshot: Value = serde_json::from_str(&stream.snapshot(&d, 7)).expect("JSON");
    check("SnapshotMessage", &snapshot);
    check("StreamMessage", &snapshot);
    // a change of each kind
    let mut limits = d.limits();
    limits.event_trail += 1;
    d.set_limits(limits);
    let mut kinds = BTreeSet::new();
    for m in stream.changes(&d) {
        let m: Value = serde_json::from_str(&m).expect("JSON");
        kinds.insert(m["type"].as_str().expect("type").to_owned());
        check("StreamMessage", &m);
    }
    assert!(kinds.contains("directory"), "{kinds:?}");
    api::tests::change(&mut d);
    let mut kinds = BTreeSet::new();
    for m in stream.changes(&d) {
        let m: Value = serde_json::from_str(&m).expect("JSON");
        kinds.insert(m["type"].as_str().expect("type").to_owned());
        check("StreamMessage", &m);
    }
    assert_eq!(kinds, ["asset", "event"].map(str::to_owned).into());
}
