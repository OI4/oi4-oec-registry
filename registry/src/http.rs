//! The HTTP server of the registry (ADR-0029 §7, increment 3): HTTP/1.1
//! with hyper 1 over TLS (rustls, [`crate::tls`]) on its own thread with a
//! tokio runtime; the resources are [`crate::api`]. Two listeners: the Web
//! UI port (default `5798`: the Web UI and `/api`) and the API port
//! (default `5799`: `/api` only), each switchable by environment.
//!
//! The hardening contract of ADR-0028 amendment C-083, as for the Web UIs
//! of the demos: one request per connection (`Connection: close`); the
//! request head within [`REQUEST_TIME`] (TLS handshake and head each) and
//! [`MAX_HEAD`] (`431` by hyper); the guards of [`crate::api::Hosts`];
//! at most [`MAX_CONNECTIONS`] connections (`503` beyond) and
//! [`MAX_STREAMS`] event streams (`503` beyond); a response is written
//! within [`RESPONSE_TIME`]; an event stream sends a comment `keep-alive`
//! when quiet and ends for a client that does not read.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::pin::{Pin, pin};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use hyper::body::{Body, Bytes, Frame, Incoming, SizeHint};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use rustls::ServerConfig;
use serde_json::json;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, mpsc};
use tokio_rustls::TlsAcceptor;

use crate::api::{self, Head, Hosts, Route, Stream};
use crate::bus::{lock, unix_ms};
use crate::directory::Directory;

/// At most this many connections at a time; more get a `503`.
pub(crate) const MAX_CONNECTIONS: usize = 16;
/// At most this many event streams at a time; more get a `503`.
pub(crate) const MAX_STREAMS: usize = 8;
/// At most this many connections beyond the limit are answered with a
/// `503` at a time; more are closed at once.
const MAX_REFUSING: usize = 16;
/// Request line and headers (hyper's read buffer, its minimum).
pub(crate) const MAX_HEAD: usize = 8 * 1024;
/// Time for the TLS handshake, and again for the request head.
pub(crate) const REQUEST_TIME: Duration = Duration::from_secs(5);
/// Time to write a response that is not an event stream.
const RESPONSE_TIME: Duration = Duration::from_secs(10);
/// How often an event stream looks at the directory.
const STREAM_POLL: Duration = Duration::from_millis(500);
/// Messages an event stream holds for a client that does not read.
const STREAM_QUEUE: usize = 32;
/// The default quiet time before a comment `keep-alive`.
const KEEP_ALIVE: Duration = Duration::from_secs(15);

/// The headers of every response besides `Content-Type`.
const COMMON_HEADERS: [(header::HeaderName, &str); 5] = [
    (header::CONNECTION, "close"),
    (header::CACHE_CONTROL, "no-store"),
    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
    (
        header::CONTENT_SECURITY_POLICY,
        "default-src 'self'; frame-ancestors 'none'",
    ),
    (header::REFERRER_POLICY, "no-referrer"),
];

/// The settings of the HTTP side, from the environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Settings {
    /// `OEC_REGISTRY_WEB`: the Web UI port (UI and `/api`).
    pub(crate) web: Option<SocketAddr>,
    /// `OEC_REGISTRY_API`: the API port (`/api` only).
    pub(crate) api: Option<SocketAddr>,
    /// `OEC_REGISTRY_TLS` is not `off`.
    pub(crate) tls: bool,
    /// `OEC_REGISTRY_HOSTS`: further names for `Host`.
    pub(crate) hosts: Vec<String>,
    /// `OEC_REGISTRY_KEEPALIVE_MS` (tests).
    pub(crate) keep_alive: Duration,
}

impl Settings {
    /// The settings from the variables `var` (the environment).
    ///
    /// # Errors
    ///
    /// A value is invalid, or both ports are the same address.
    pub(crate) fn from(var: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let addr = |name: &str, default: &str| -> Result<Option<SocketAddr>, String> {
            let v = var(name).unwrap_or_else(|| default.to_owned());
            if v.trim().is_empty() {
                return Ok(None);
            }
            v.trim()
                .parse()
                .map(Some)
                .map_err(|_| format!("{name}={v}: not an address host:port (empty = off)"))
        };
        let web = addr("OEC_REGISTRY_WEB", "0.0.0.0:5798")?;
        let api = addr("OEC_REGISTRY_API", "0.0.0.0:5799")?;
        if web.is_some() && web == api {
            return Err("OEC_REGISTRY_WEB and OEC_REGISTRY_API are the same address".to_owned());
        }
        let tls = match var("OEC_REGISTRY_TLS").as_deref().map(str::trim) {
            None | Some("" | "on") => true,
            Some("off") => false,
            Some(v) => return Err(format!("OEC_REGISTRY_TLS={v}: `on` or `off`")),
        };
        let hosts = var("OEC_REGISTRY_HOSTS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .map(str::to_owned)
            .collect();
        let keep_alive = match var("OEC_REGISTRY_KEEPALIVE_MS") {
            None => KEEP_ALIVE,
            Some(v) => match v.trim().parse::<u64>() {
                Ok(ms @ 1..=15_000) => Duration::from_millis(ms),
                _ => return Err(format!("OEC_REGISTRY_KEEPALIVE_MS={v}: 1 … 15000")),
            },
        };
        Ok(Self {
            web,
            api,
            tls,
            hosts,
            keep_alive,
        })
    }
}

/// The bound listeners (bound before the application starts, so that a
/// taken port stops the registry at once).
#[derive(Debug)]
pub(crate) struct Listeners {
    web: Option<std::net::TcpListener>,
    api: Option<std::net::TcpListener>,
}

impl Listeners {
    /// Binds the ports of `s`.
    ///
    /// # Errors
    ///
    /// A port cannot be bound.
    pub(crate) fn bind(s: &Settings) -> Result<Self, String> {
        let bind = |a: Option<SocketAddr>| -> Result<Option<std::net::TcpListener>, String> {
            a.map(|a| {
                let l = std::net::TcpListener::bind(a).map_err(|e| format!("HTTP: {a}: {e}"))?;
                l.set_nonblocking(true)
                    .map_err(|e| format!("HTTP: {a}: {e}"))?;
                Ok(l)
            })
            .transpose()
        };
        Ok(Self {
            web: bind(s.web)?,
            api: bind(s.api)?,
        })
    }

    /// The bound addresses (Web UI, API).
    pub(crate) fn addrs(&self) -> (Option<SocketAddr>, Option<SocketAddr>) {
        let a = |l: &Option<std::net::TcpListener>| l.as_ref().and_then(|l| l.local_addr().ok());
        (a(&self.web), a(&self.api))
    }
}

/// What the connections share.
struct Shared {
    dir: Arc<Mutex<Directory>>,
    hosts: Hosts,
    tls: Option<TlsAcceptor>,
    keep_alive: Duration,
    connections: AtomicUsize,
    refusing: AtomicUsize,
    streams: AtomicUsize,
}

/// A place counted in a limit while it lives.
struct Slot<'a>(&'a AtomicUsize);

impl<'a> Slot<'a> {
    fn take(count: &'a AtomicUsize, max: usize) -> Option<Self> {
        if count.fetch_add(1, Ordering::SeqCst) >= max {
            count.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(Self(count))
    }
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Serves the listeners on a thread of its own until the process ends.
///
/// # Errors
///
/// The runtime or the thread cannot be started.
pub(crate) fn start(
    listeners: Listeners,
    tls: Option<Arc<ServerConfig>>,
    hosts: Hosts,
    keep_alive: Duration,
    dir: Arc<Mutex<Directory>>,
) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .map_err(|e| format!("HTTP: {e}"))?;
    let shared = Arc::new(Shared {
        dir,
        hosts,
        tls: tls.map(TlsAcceptor::from),
        keep_alive,
        connections: AtomicUsize::new(0),
        refusing: AtomicUsize::new(0),
        streams: AtomicUsize::new(0),
    });
    std::thread::Builder::new()
        .name("oec-registry-http".to_owned())
        .spawn(move || {
            runtime.block_on(async move {
                let mut tasks = Vec::new();
                for (listener, ui) in [(listeners.web, true), (listeners.api, false)] {
                    let Some(l) = listener else { continue };
                    match TcpListener::from_std(l) {
                        Ok(l) => tasks.push(tokio::spawn(accept(l, ui, Arc::clone(&shared)))),
                        Err(e) => log::error!("HTTP: {e}"),
                    }
                }
                for t in tasks {
                    let _ = t.await;
                }
            });
        })
        .map(|_| ())
        .map_err(|e| format!("HTTP: {e}"))
}

async fn accept(listener: TcpListener, ui: bool, s: Arc<Shared>) {
    loop {
        let tcp = match listener.accept().await {
            Ok((tcp, _)) => tcp,
            Err(e) => {
                log::debug!("HTTP: accept: {e}");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let s = Arc::clone(&s);
        tokio::spawn(async move {
            if let Some(_slot) = Slot::take(&s.connections, MAX_CONNECTIONS) {
                connection(tcp, ui, false, &s).await;
            } else if let Some(_slot) = Slot::take(&s.refusing, MAX_REFUSING) {
                connection(tcp, ui, true, &s).await;
            }
        });
    }
}

/// One connection: TLS handshake, one request (`refuse`: answered with
/// `503`), the response.
async fn connection(tcp: TcpStream, ui: bool, refuse: bool, s: &Arc<Shared>) {
    let _ = tcp.set_nodelay(true);
    match &s.tls {
        Some(acceptor) => {
            if let Ok(Ok(tls)) = tokio::time::timeout(REQUEST_TIME, acceptor.accept(tcp)).await {
                exchange(TokioIo::new(tls), ui, refuse, s).await;
            }
        }
        None => exchange(TokioIo::new(tcp), ui, refuse, s).await,
    }
}

async fn exchange<I>(io: I, ui: bool, refuse: bool, s: &Arc<Shared>)
where
    I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    // ends the connection: a response not written in time, a stream whose
    // client does not read
    let end = Arc::new(Notify::new());
    let service = {
        let (s, end) = (Arc::clone(s), Arc::clone(&end));
        service_fn(move |req: Request<Incoming>| {
            let response = handle(&s, ui, refuse, &req, &end);
            if !matches!(response.body(), Out::Stream(_)) {
                let end = Arc::clone(&end);
                tokio::spawn(async move {
                    tokio::time::sleep(RESPONSE_TIME).await;
                    end.notify_one();
                });
            }
            std::future::ready(Ok::<_, Infallible>(response))
        })
    };
    let mut conn = pin!(
        http1::Builder::new()
            .keep_alive(false)
            .timer(TokioTimer::new())
            .header_read_timeout(REQUEST_TIME)
            .max_buf_size(MAX_HEAD)
            .serve_connection(io, service)
    );
    let mut ended = pin!(end.notified());
    std::future::poll_fn(|cx| {
        if conn.as_mut().poll(cx).is_ready() || ended.as_mut().poll(cx).is_ready() {
            Poll::Ready(())
        } else {
            Poll::Pending
        }
    })
    .await;
}

/// The body of a response: complete, or the messages of an event stream.
pub(crate) enum Out {
    Full(Option<Bytes>),
    Stream(mpsc::Receiver<Bytes>),
}

impl Body for Out {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        match self.get_mut() {
            Self::Full(b) => Poll::Ready(b.take().map(|b| Ok(Frame::data(b)))),
            Self::Stream(rx) => rx.poll_recv(cx).map(|m| m.map(|b| Ok(Frame::data(b)))),
        }
    }

    fn is_end_stream(&self) -> bool {
        matches!(self, Self::Full(None))
    }

    fn size_hint(&self) -> SizeHint {
        match self {
            Self::Full(b) => SizeHint::with_exact(b.as_ref().map_or(0, |b| b.len() as u64)),
            Self::Stream(_) => SizeHint::default(),
        }
    }
}

fn respond(status: u16, content_type: &'static str, body: Out) -> Response<Out> {
    let mut r = Response::new(body);
    *r.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    for (name, value) in COMMON_HEADERS {
        h.insert(name, HeaderValue::from_static(value));
    }
    r
}

fn content(status: u16, content_type: &'static str, body: Bytes) -> Response<Out> {
    respond(status, content_type, Out::Full(Some(body)))
}

fn json(status: u16, value: &serde_json::Value) -> Response<Out> {
    content(status, "application/json", Bytes::from(value.to_string()))
}

fn error(status: u16, message: &str) -> Response<Out> {
    let mut r = json(status, &json!({ "error": message }));
    if status == 405 {
        r.headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET"));
    }
    r
}

/// The values of the header `name` (a value that is no text: empty).
fn values<'a>(req: &'a Request<Incoming>, name: &header::HeaderName) -> Vec<&'a str> {
    req.headers()
        .get_all(name)
        .iter()
        .map(|v| v.to_str().unwrap_or_default())
        .collect()
}

fn handle(
    s: &Arc<Shared>,
    ui: bool,
    refuse: bool,
    req: &Request<Incoming>,
    end: &Arc<Notify>,
) -> Response<Out> {
    if refuse {
        return error(503, "too many connections");
    }
    let mut hosts = values(req, &header::HOST);
    // an absolute target names the host too: it has to be the same
    if let Some(authority) = req.uri().authority() {
        if hosts
            .iter()
            .any(|h| !h.eq_ignore_ascii_case(authority.as_str()))
        {
            return error(400, "the target and Host differ");
        }
        if hosts.is_empty() {
            hosts.push(authority.as_str());
        }
    }
    let head = Head {
        method: req.method().as_str(),
        hosts,
        origins: values(req, &header::ORIGIN),
        transfer_encoding: req.headers().contains_key(header::TRANSFER_ENCODING),
        content_length: values(req, &header::CONTENT_LENGTH),
    };
    if let Err((status, why)) = s.hosts.check(&head) {
        return error(status, why);
    }
    let Some(route) = api::route(req.uri().path(), ui) else {
        return error(404, "not found");
    };
    let dir = || lock(&s.dir);
    match route {
        Route::Ui(f) => content(200, f.content_type, Bytes::from_static(f.bytes)),
        Route::Assets => json(200, &api::assets(&dir(), unix_ms())),
        Route::Asset(il) => match api::asset(&dir(), &il) {
            Some(v) => json(200, &v),
            None => error(404, "no such asset"),
        },
        Route::Events => json(200, &api::events(&dir())),
        Route::OpenApi => content(
            200,
            "application/json",
            Bytes::from_static(api::OPENAPI.as_bytes()),
        ),
        Route::AsyncApi => content(
            200,
            "application/json",
            Bytes::from_static(api::ASYNCAPI.as_bytes()),
        ),
        Route::Stream => {
            if Slot::take(&s.streams, MAX_STREAMS)
                .map(std::mem::forget)
                .is_none()
            {
                return error(503, "too many event streams");
            }
            let (tx, rx) = mpsc::channel(STREAM_QUEUE);
            tokio::spawn(produce(Arc::clone(s), tx, Arc::clone(end)));
            respond(200, "text/event-stream", Out::Stream(rx))
        }
    }
}

/// The messages of an event stream (see [`api::Stream`]) until the client
/// goes; one that does not read ends its connection.
async fn produce(s: Arc<Shared>, tx: mpsc::Sender<Bytes>, end: Arc<Notify>) {
    // the place taken in `handle`
    let _slot = Slot(&s.streams);
    let mut stream = Stream::default();
    let first = stream.snapshot(&lock(&s.dir), unix_ms());
    let send = |data: &[u8]| match tx.try_send(Bytes::copy_from_slice(data)) {
        Ok(()) => true,
        Err(mpsc::error::TrySendError::Full(_)) => {
            end.notify_one();
            false
        }
        Err(mpsc::error::TrySendError::Closed(_)) => false,
    };
    if !send(format!("data: {first}\n\n").as_bytes()) {
        return;
    }
    let mut quiet = tokio::time::Instant::now();
    loop {
        tokio::time::sleep(STREAM_POLL).await;
        if tx.is_closed() {
            return;
        }
        let messages = stream.changes(&lock(&s.dir));
        if messages.is_empty() {
            if quiet.elapsed() < s.keep_alive {
                continue;
            }
            if !send(b": keep-alive\n\n") {
                return;
            }
        }
        for m in messages {
            if !send(format!("data: {m}\n\n").as_bytes()) {
                return;
            }
        }
        quiet = tokio::time::Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            vars.iter()
                .find(|(n, _)| *n == name)
                .map(|(_, v)| (*v).to_owned())
        }
    }

    #[test]
    fn settings() {
        let d = Settings::from(env(&[])).unwrap();
        assert_eq!(d.web, Some("0.0.0.0:5798".parse().unwrap()));
        assert_eq!(d.api, Some("0.0.0.0:5799".parse().unwrap()));
        assert!(d.tls);
        assert!(d.hosts.is_empty());
        assert_eq!(d.keep_alive, KEEP_ALIVE);
        let s = Settings::from(env(&[
            ("OEC_REGISTRY_WEB", ""),
            ("OEC_REGISTRY_API", "[::1]:8443"),
            ("OEC_REGISTRY_TLS", "off"),
            ("OEC_REGISTRY_HOSTS", " registry.example, ,reg "),
            ("OEC_REGISTRY_KEEPALIVE_MS", "200"),
        ]))
        .unwrap();
        assert_eq!(s.web, None);
        assert_eq!(s.api, Some("[::1]:8443".parse().unwrap()));
        assert!(!s.tls);
        assert_eq!(s.hosts, ["registry.example", "reg"]);
        assert_eq!(s.keep_alive, Duration::from_millis(200));
        for bad in [
            [("OEC_REGISTRY_WEB", "localhost:1")],
            [("OEC_REGISTRY_API", "5799")],
            [("OEC_REGISTRY_TLS", "no")],
            [("OEC_REGISTRY_KEEPALIVE_MS", "0")],
            [("OEC_REGISTRY_KEEPALIVE_MS", "15001")],
            [("OEC_REGISTRY_WEB", "0.0.0.0:5799")],
        ] {
            assert!(Settings::from(env(&bad)).is_err(), "{bad:?}");
        }
    }

    /// One request on a fresh connection; the response as text.
    fn exchange(addr: SocketAddr, request: &str) -> String {
        use std::io::{Read, Write};
        let mut c = std::net::TcpStream::connect(addr).unwrap();
        c.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        c.write_all(request.as_bytes()).unwrap();
        let mut out = Vec::new();
        let mut buf = [0; 4096];
        // an event stream does not end: its first message is enough
        while let Ok(n @ 1..) = c.read(&mut buf) {
            out.extend_from_slice(&buf[..n]);
            if String::from_utf8_lossy(&out).contains("}\n\n") {
                break;
            }
        }
        String::from_utf8(out).unwrap()
    }

    /// The server over loopback (plain; TLS: the Go tests): the views, the
    /// headers, the guards and the event stream.
    #[test]
    fn served_over_loopback() {
        let settings = Settings {
            web: Some("127.0.0.1:0".parse().unwrap()),
            api: Some("127.0.0.1:0".parse().unwrap()),
            tls: false,
            hosts: Vec::new(),
            keep_alive: KEEP_ALIVE,
        };
        let listeners = Listeners::bind(&settings).unwrap();
        let (Some(web), Some(api)) = listeners.addrs() else {
            panic!("bound")
        };
        let dir = Arc::new(Mutex::new(crate::api::tests::fixture()));
        start(listeners, None, Hosts::new([], false), KEEP_ALIVE, dir).unwrap();
        let get = |addr: SocketAddr, path: &str| {
            exchange(
                addr,
                &format!("GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            )
        };
        let r = get(api, "/api/assets");
        assert!(r.starts_with("HTTP/1.1 200 OK\r\n"), "{r}");
        for h in [
            "content-type: application/json",
            "connection: close",
            "cache-control: no-store",
            "x-content-type-options: nosniff",
            "referrer-policy: no-referrer",
        ] {
            assert!(r.to_ascii_lowercase().contains(h), "{h}: {r}");
        }
        assert!(r.contains(crate::api::tests::APP), "{r}");
        let r = get(web, "/");
        assert!(
            r.starts_with("HTTP/1.1 200 OK\r\n")
                && r.contains("text/html")
                && r.contains(r#"<div id="root">"#),
            "{r}"
        );
        for f in crate::ui_assets::UI_FILES {
            let r = get(web, f.path);
            assert!(
                r.starts_with("HTTP/1.1 200 OK\r\n")
                    && r.to_ascii_lowercase()
                        .contains(&format!("content-type: {}", f.content_type)),
                "{}: {r}",
                f.path
            );
            assert!(get(api, f.path).starts_with("HTTP/1.1 404 "), "{}", f.path);
        }
        assert!(get(web, "/nope.js").starts_with("HTTP/1.1 404 "));
        assert!(get(api, "/").starts_with("HTTP/1.1 404 "));
        assert!(get(api, "/api/assets/nope").starts_with("HTTP/1.1 404 "));
        let r = exchange(
            api,
            "POST /api/assets HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}",
        );
        assert!(r.starts_with("HTTP/1.1 405 "), "{r}");
        assert!(r.to_ascii_lowercase().contains("allow: get"), "{r}");
        let r = exchange(
            api,
            "GET /api/events HTTP/1.1\r\nHost: evil.example\r\n\r\n",
        );
        assert!(r.starts_with("HTTP/1.1 403 "), "{r}");
        let r = exchange(
            api,
            "GET http://evil.example/api/events HTTP/1.1\r\nHost: localhost\r\n\r\n",
        );
        assert!(r.starts_with("HTTP/1.1 400 "), "{r}");
        let r = get(web, "/api/stream");
        assert!(r.starts_with("HTTP/1.1 200 OK\r\n"), "{r}");
        assert!(r.contains("text/event-stream"), "{r}");
        assert!(
            r.contains("data: {") && r.contains(r#""type":"snapshot""#),
            "{r}"
        );
    }

    #[test]
    fn a_taken_port_is_an_error() {
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let s = Settings {
            web: Some(taken.local_addr().unwrap()),
            api: None,
            tls: true,
            hosts: Vec::new(),
            keep_alive: KEEP_ALIVE,
        };
        assert!(Listeners::bind(&s).is_err());
        let s = Settings {
            web: Some("127.0.0.1:0".parse().unwrap()),
            ..s
        };
        let l = Listeners::bind(&s).unwrap();
        assert!(l.addrs().0.is_some());
        assert!(l.addrs().1.is_none());
    }
}
