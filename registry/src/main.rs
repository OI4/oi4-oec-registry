//! `oec-registry`: the OEC Registry D5 of P7 (ADR-0029, MG A1). Step 1
//! (ADR-0008): read-only. It collects the MAM and Health of the assets on
//! the Message Bus (REQ-REG-001) and offers them to others with the
//! Registry services `Get/MAM[/<Source>]` and `Get/Health[/<Source>]` on
//! its own AppId (REQ-REG-002). It also collects the Profile, Events,
//! PublicationList and SubscriptionList of the applications, observes
//! their Messaging level and checks their messages against the schemas
//! (informative). Its settings are its own Config `registry`. It shows
//! its directory read-only over HTTPS ([`http`], [`api`]: REST, server-sent
//! events, OpenAPI, AsyncAPI).
//!
//! Environment: `OEC_ROOT` (container storage, default `/`),
//! `OEC_REGISTRY_LOG` (`error`, `warn`, `info` (default), `debug`) for the
//! local log on stderr, and for the HTTP side `OEC_REGISTRY_WEB` (Web UI
//! and API, default `0.0.0.0:5798`), `OEC_REGISTRY_API` (API only, default
//! `0.0.0.0:5799`) – an empty value switches the port off –,
//! `OEC_REGISTRY_TLS` (`on` (default) or `off`: plain HTTP, for
//! development only), `OEC_REGISTRY_HOSTS` (further names of the registry
//! for `Host`, comma-separated) and `OEC_REGISTRY_KEEPALIVE_MS` (quiet time
//! of an event stream before a comment, 1 … 15000, default 15000).

mod api;
#[cfg(test)]
mod api_tests;
mod bus;
mod directory;
mod http;
mod tls;
mod ui_assets;

use std::path::PathBuf;
use std::process::ExitCode;

use log::{LevelFilter, Log, Metadata, Record};
use oec::prelude::*;

/// The local log on stderr; the SDK bridges the records to Syslog events
/// on the bus too.
struct Stderr(LevelFilter);

impl Log for Stderr {
    fn enabled(&self, m: &Metadata<'_>) -> bool {
        m.level() <= self.0
    }
    fn log(&self, r: &Record<'_>) {
        if self.enabled(r.metadata()) {
            eprintln!("{} {}: {}", r.level(), r.target(), r.args());
        }
    }
    fn flush(&self) {}
}

/// The product of the registry (ADR-0029 §2).
fn product() -> Product {
    Product::new("oi4.org", "OEC Registry", "OEC-REGISTRY")
        .manufacturer("Open Industry 4.0 Alliance")
        .description("OEC Registry of OI4 Open Edge Computing")
        .software_revision(env!("CARGO_PKG_VERSION"))
}

/// The Messaging level of the registry (ADR-0029 §2, increment 2):
/// Level 3, with its own Config and a persistent ReferenceDesignation.
const LEVEL: Level = Level::L3;

fn run() -> Result<(), String> {
    let level = match std::env::var("OEC_REGISTRY_LOG").as_deref() {
        Ok("error") => LevelFilter::Error,
        Ok("warn") => LevelFilter::Warn,
        Ok("debug") => LevelFilter::Debug,
        _ => LevelFilter::Info,
    };
    oec::event::install_bridge(Some(Box::new(Stderr(level)))).map_err(|e| e.to_string())?;
    let root = std::env::var_os("OEC_ROOT").map_or_else(|| PathBuf::from("/"), PathBuf::from);
    let settings = http::Settings::from(|name| std::env::var(name).ok())?;
    let listeners = http::Listeners::bind(&settings)?;
    let app = App::builder(LEVEL, ServiceType::Registry, product())
        .bootstrap(Bootstrap::ContainerStorage { root })
        .build()
        .map_err(|e| e.to_string())?;
    log::info!(
        "OEC Registry {} at Level {LEVEL:?}",
        app.identification_link().as_str()
    );
    let config = app
        .this()
        .add_config(bus::config())
        .map_err(|e| e.to_string())?;
    let bus = bus::Bus::start(app.handle(), config)?;
    serve(&app, &settings, listeners, &bus)?;
    app.run().map_err(|e| e.to_string())
}

/// Starts the HTTP side, if a port is on.
fn serve(
    app: &App,
    settings: &http::Settings,
    listeners: http::Listeners,
    bus: &bus::Bus,
) -> Result<(), String> {
    let (web_port, api_port) = listeners.addrs();
    if web_port.is_none() && api_port.is_none() {
        log::info!("HTTP: off");
        return Ok(());
    }
    let auth = app.connection().auth();
    let files = tls::Files::of(auth);
    // the container name: the name of the certificate file, else the
    // serial number of the registry (the container name, ADR-0029 §2)
    let container = files
        .and_then(|f| f.cert.file_stem())
        .and_then(|s| s.to_str())
        .map(str::to_owned)
        .or_else(|| {
            app.identification_link()
                .as_str()
                .rsplit('/')
                .next()
                .map(str::to_owned)
        });
    let hosts = api::Hosts::new(
        container.into_iter().chain(settings.hosts.iter().cloned()),
        settings.tls,
    );
    let tls = if settings.tls {
        let mut names = hosts.names().to_vec();
        names.extend(["127.0.0.1".to_owned(), "::1".to_owned()]);
        let (config, origin) = tls::server_config(files, &names)?;
        log::info!(
            "HTTP: TLS with {}",
            match origin {
                tls::Origin::Application => "the application certificate",
                tls::Origin::SelfSigned => "a self-signed certificate",
            }
        );
        Some(config)
    } else {
        log::warn!("HTTP: plain, without TLS (OEC_REGISTRY_TLS=off, for development only)");
        None
    };
    let scheme = if settings.tls { "https" } else { "http" };
    if let Some(a) = web_port {
        log::info!("HTTP: Web UI and API on {scheme}://{a}");
    }
    if let Some(a) = api_port {
        log::info!("HTTP: API on {scheme}://{a}");
    }
    http::start(listeners, tls, hosts, settings.keep_alive, bus.directory())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("oec-registry: {e}");
            ExitCode::FAILURE
        }
    }
}
