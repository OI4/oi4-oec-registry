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
//!
//! The user management of ADR-0035 (C-113): the session of a request is the
//! token of `Authorization: Bearer` or of the session cookie; a resource
//! needs the [`Access`] of its route; password hashing runs on the blocking
//! pool, at most [`HASHING`] at a time; an event stream ends with its
//! session.

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::pin::{Pin, pin};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use hyper::body::{Body, Bytes, Frame, Incoming, SizeHint};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use rustls::ServerConfig;
use serde_json::json;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, Semaphore, mpsc};
use tokio_rustls::TlsAcceptor;

use crate::api::{self, Access, Head, Hosts, Route, Stream};
use crate::auth::{self, Auth, Role};
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
/// At most this many password hashes are computed at a time.
const HASHING: usize = 2;
/// How long a request waits for a place to hash; then `503`.
const HASHING_WAIT: Duration = Duration::from_secs(5);
/// The session cookie over TLS (ADR-0035 §4) and its attributes.
const COOKIE_TLS: (&str, &str) = (
    "__Host-oec_session",
    "; Path=/; Secure; HttpOnly; SameSite=Strict",
);
/// The session cookie over plain HTTP (development only).
const COOKIE_PLAIN: (&str, &str) = ("oec_session", "; Path=/; HttpOnly; SameSite=Strict");

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
    auth: Mutex<Auth>,
    hashing: Semaphore,
    /// The session cookie: name and attributes.
    cookie: (&'static str, &'static str),
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
    auth: Auth,
) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .map_err(|e| format!("HTTP: {e}"))?;
    let shared = Arc::new(Shared {
        dir,
        auth: Mutex::new(auth),
        hashing: Semaphore::new(HASHING),
        cookie: if tls.is_some() {
            COOKIE_TLS
        } else {
            COOKIE_PLAIN
        },
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
        let (tcp, ip) = match listener.accept().await {
            Ok((tcp, peer)) => (tcp, peer.ip()),
            Err(e) => {
                log::debug!("HTTP: accept: {e}");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let s = Arc::clone(&s);
        tokio::spawn(async move {
            if let Some(_slot) = Slot::take(&s.connections, MAX_CONNECTIONS) {
                connection(tcp, ip, ui, false, &s).await;
            } else if let Some(_slot) = Slot::take(&s.refusing, MAX_REFUSING) {
                connection(tcp, ip, ui, true, &s).await;
            }
        });
    }
}

/// One connection: TLS handshake, one request (`refuse`: answered with
/// `503`), the response.
async fn connection(tcp: TcpStream, ip: IpAddr, ui: bool, refuse: bool, s: &Arc<Shared>) {
    let _ = tcp.set_nodelay(true);
    match &s.tls {
        Some(acceptor) => {
            if let Ok(Ok(tls)) = tokio::time::timeout(REQUEST_TIME, acceptor.accept(tcp)).await {
                exchange(TokioIo::new(tls), ip, ui, refuse, s).await;
            }
        }
        None => exchange(TokioIo::new(tcp), ip, ui, refuse, s).await,
    }
}

async fn exchange<I>(io: I, ip: IpAddr, ui: bool, refuse: bool, s: &Arc<Shared>)
where
    I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    // ends the connection: a response not written in time, a stream whose
    // client does not read
    let end = Arc::new(Notify::new());
    let service = {
        let (s, end) = (Arc::clone(s), Arc::clone(&end));
        service_fn(move |req: Request<Incoming>| {
            let (s, end) = (Arc::clone(&s), Arc::clone(&end));
            async move {
                // the time for the body, the hashing and the response; an
                // event stream has no end
                let timer = {
                    let end = Arc::clone(&end);
                    tokio::spawn(async move {
                        tokio::time::sleep(RESPONSE_TIME).await;
                        end.notify_one();
                    })
                };
                let response = handle(&s, ip, ui, refuse, req, &end).await;
                if matches!(response.body(), Out::Stream(_)) {
                    timer.abort();
                }
                Ok::<_, Infallible>(response)
            }
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
    if status == 401 {
        r.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Bearer realm=\"oec-registry\""),
        );
    }
    r
}

/// `405` with the methods of the route.
fn not_allowed(allow: &'static str) -> Response<Out> {
    let mut r = error(405, "method not allowed");
    r.headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(allow));
    r
}

/// `204` without a body.
fn no_content() -> Response<Out> {
    let mut r = respond(204, "application/json", Out::Full(None));
    r.headers_mut().remove(header::CONTENT_TYPE);
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

/// The session token of a request: `Authorization: Bearer`, else the
/// session cookie.
fn token(req: &Request<Incoming>, cookie: &str) -> Option<String> {
    let mut auths = req.headers().get_all(header::AUTHORIZATION).iter();
    if let Some(a) = auths.next() {
        let a = a.to_str().ok()?;
        let (scheme, t) = a.split_once(' ')?;
        return (auths.next().is_none() && scheme.eq_ignore_ascii_case("bearer"))
            .then(|| t.trim().to_owned());
    }
    values(req, &header::COOKIE)
        .iter()
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().split_once('='))
        .find(|(n, _)| *n == cookie)
        .map(|(_, v)| v.to_owned())
}

/// A refusal (boxed: a response is large).
type Fail = Box<Response<Out>>;

fn fail(status: u16, message: &str) -> Fail {
    Box::new(error(status, message))
}

/// The members of a JSON body: an object of strings, only `allowed` ones,
/// all `required` ones.
async fn body(
    req: Request<Incoming>,
    allowed: &[&str],
    required: &[&str],
) -> Result<std::collections::HashMap<String, String>, Fail> {
    let json_type = values(&req, &header::CONTENT_TYPE)
        .first()
        .is_some_and(|t| {
            t.split(';')
                .next()
                .is_some_and(|m| m.trim().eq_ignore_ascii_case("application/json"))
        });
    if !json_type {
        return Err(fail(415, "the body is application/json"));
    }
    let mut incoming = req.into_body();
    let mut bytes = Vec::new();
    let read = async {
        while let Some(frame) =
            std::future::poll_fn(|cx| Pin::new(&mut incoming).poll_frame(cx)).await
        {
            let Ok(frame) = frame else {
                return Err(fail(400, "the body is broken"));
            };
            if let Some(data) = frame.data_ref() {
                if bytes.len() + data.len() > api::MAX_JSON {
                    return Err(fail(413, "the body is too large"));
                }
                bytes.extend_from_slice(data);
            }
        }
        Ok(())
    };
    tokio::time::timeout(REQUEST_TIME, read)
        .await
        .map_err(|_| fail(408, "the body is too slow"))??;
    let Ok(serde_json::Value::Object(members)) = serde_json::from_slice(&bytes) else {
        return Err(fail(400, "the body is a JSON object"));
    };
    let mut out = std::collections::HashMap::new();
    for (k, v) in members {
        let (true, serde_json::Value::String(v)) = (allowed.contains(&k.as_str()), v) else {
            return Err(fail(400, "unknown member or not a string"));
        };
        out.insert(k, v);
    }
    if required.iter().any(|r| !out.contains_key(*r)) {
        return Err(fail(400, "a member is missing"));
    }
    Ok(out)
}

/// Runs `f` (password hashing) on the blocking pool, at most [`HASHING`]
/// at a time.
async fn hashing<T: Send + 'static>(
    s: &Shared,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Fail> {
    let Ok(Ok(_permit)) = tokio::time::timeout(HASHING_WAIT, s.hashing.acquire()).await else {
        return Err(fail(503, "busy, try again"));
    };
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| fail(500, "hashing failed"))
}

fn too_many(secs: u64) -> Response<Out> {
    let mut r = error(429, "too many failed attempts, wait");
    r.headers_mut()
        .insert(header::RETRY_AFTER, HeaderValue::from(secs));
    r
}

fn set_cookie(r: &mut Response<Out>, cookie: (&str, &str), value: &str, clear: bool) {
    let max_age = if clear { "; Max-Age=0" } else { "" };
    if let Ok(v) = HeaderValue::from_str(&format!("{}={value}{}{max_age}", cookie.0, cookie.1)) {
        r.headers_mut().insert(header::SET_COOKIE, v);
    }
}

/// The guards of [`Hosts::check`] and the route.
fn guard(s: &Shared, ui: bool, req: &Request<Incoming>) -> Result<Route, Fail> {
    let mut hosts = values(req, &header::HOST);
    // an absolute target names the host too: it has to be the same
    if let Some(authority) = req.uri().authority() {
        if hosts
            .iter()
            .any(|h| !h.eq_ignore_ascii_case(authority.as_str()))
        {
            return Err(fail(400, "the target and Host differ"));
        }
        if hosts.is_empty() {
            hosts.push(authority.as_str());
        }
    }
    let head = Head {
        hosts,
        origins: values(req, &header::ORIGIN),
        transfer_encoding: req.headers().contains_key(header::TRANSFER_ENCODING),
        content_length: values(req, &header::CONTENT_LENGTH),
    };
    s.hosts
        .check(&head)
        .map_err(|(status, why)| fail(status, why))?;
    let route = api::route(req.uri().path(), ui).ok_or_else(|| fail(404, "not found"))?;
    if !route.methods().contains(&req.method().as_str()) {
        return Err(Box::new(not_allowed(route.allow())));
    }
    Ok(route)
}

/// The user of the session of a request, if the route needs one.
fn user(s: &Shared, route: &Route, token: Option<&str>) -> Result<Option<auth::User>, Fail> {
    let access = route.access();
    if access == Access::Public {
        return Ok(None);
    }
    let user = token
        .and_then(|t| lock(&s.auth).session(t, Instant::now()))
        .ok_or_else(|| fail(401, "log in first"))?;
    if user.must_change && access != Access::Session {
        return Err(fail(403, "change the password first"));
    }
    if access == Access::Admin && user.role != Role::Admin {
        return Err(fail(403, "for admins only"));
    }
    Ok(Some(user))
}

async fn handle(
    s: &Arc<Shared>,
    ip: IpAddr,
    ui: bool,
    refuse: bool,
    req: Request<Incoming>,
    end: &Arc<Notify>,
) -> Response<Out> {
    if refuse {
        return error(503, "too many connections");
    }
    let route = match guard(s, ui, &req) {
        Ok(r) => r,
        Err(r) => return *r,
    };
    let token = token(&req, s.cookie.0);
    let user = match user(s, &route, token.as_deref()) {
        Ok(u) => u,
        Err(r) => return *r,
    };
    let post = req.method() != hyper::Method::GET;
    let dir = || lock(&s.dir);
    let result = match (route, user) {
        (Route::Login, _) => login(s, ip, req).await,
        (Route::Logout, _) => {
            if let Some(t) = &token {
                lock(&s.auth).logout(t);
            }
            let mut r = no_content();
            set_cookie(&mut r, s.cookie, "", true);
            Ok(r)
        }
        (Route::Session, Some(u)) => Ok(json(200, &u.view())),
        (Route::Password, Some(u)) => {
            password(s, ip, &u, token.as_deref().unwrap_or_default(), req).await
        }
        (Route::Users, _) if !post => Ok(json(200, &lock(&s.auth).list())),
        (Route::Users, _) => create(s, req).await,
        (Route::User(name), _) if req.method() == hyper::Method::PUT => update(s, &name, req).await,
        (Route::User(name), _) => {
            let deleted = lock(&s.auth).delete(&name);
            deleted
                .map(|()| no_content())
                .map_err(|(status, why)| fail(status, why))
        }
        (Route::Ui(f), _) => Ok(content(200, f.content_type, Bytes::from_static(f.bytes))),
        (Route::Assets, _) => Ok(json(200, &api::assets(&dir(), unix_ms()))),
        (Route::Asset(il), _) => {
            let found = api::asset(&dir(), &il);
            found
                .map(|v| json(200, &v))
                .ok_or_else(|| fail(404, "no such asset"))
        }
        (Route::Events, _) => Ok(json(200, &api::events(&dir()))),
        (Route::Data, _) => Ok(json(200, &api::data(&dir()))),
        (Route::OpenApi, _) => Ok(content(
            200,
            "application/json",
            Bytes::from_static(api::OPENAPI.as_bytes()),
        )),
        (Route::AsyncApi, _) => Ok(content(
            200,
            "application/json",
            Bytes::from_static(api::ASYNCAPI.as_bytes()),
        )),
        (Route::Stream, _) => {
            if Slot::take(&s.streams, MAX_STREAMS)
                .map(std::mem::forget)
                .is_none()
            {
                return error(503, "too many event streams");
            }
            let (tx, rx) = mpsc::channel(STREAM_QUEUE);
            let token = token.unwrap_or_default();
            tokio::spawn(produce(Arc::clone(s), tx, Arc::clone(end), token));
            Ok(respond(200, "text/event-stream", Out::Stream(rx)))
        }
        (Route::Session | Route::Password, None) => Err(fail(401, "log in first")),
    };
    result.unwrap_or_else(|r| *r)
}

/// `POST /api/login`.
async fn login(s: &Arc<Shared>, ip: IpAddr, req: Request<Incoming>) -> Result<Response<Out>, Fail> {
    let b = body(req, &["name", "password"], &["name", "password"]).await?;
    let (name, password) = (b["name"].clone(), b["password"].clone());
    let stored = lock(&s.auth).login_hash(ip, &name, Instant::now());
    let stored = stored.map_err(too_many)?;
    let checked = stored.clone();
    if hashing(s, move || auth::verify(&password, &checked)).await? {
        let session = lock(&s.auth).logged_in(ip, &name, &stored, Instant::now());
        if let Some((user, token)) = session {
            let mut v = user.view();
            v["token"] = token.clone().into();
            let mut r = json(200, &v);
            set_cookie(&mut r, s.cookie, &token, false);
            return Ok(r);
        }
    }
    lock(&s.auth).failed(ip, Instant::now());
    Err(fail(401, "wrong name or password"))
}

/// `POST /api/password`: the own password.
async fn password(
    s: &Arc<Shared>,
    ip: IpAddr,
    user: &auth::User,
    token: &str,
    req: Request<Incoming>,
) -> Result<Response<Out>, Fail> {
    let b = body(req, &["current", "new"], &["current", "new"]).await?;
    let (current, new) = (b["current"].clone(), b["new"].clone());
    auth::check_password(&user.name, &new).map_err(|why| fail(400, why))?;
    if new == current {
        return Err(fail(400, "the new password is the current one"));
    }
    let stored = lock(&s.auth).login_hash(ip, &user.name, Instant::now());
    let stored = stored.map_err(too_many)?;
    let iterations = lock(&s.auth).iterations;
    let checked = stored.clone();
    let new_hash = hashing(s, move || {
        auth::verify(&current, &checked).then(|| auth::hash(&new, iterations))
    })
    .await?;
    let Some(new_hash) = new_hash else {
        lock(&s.auth).failed(ip, Instant::now());
        return Err(fail(403, "wrong password"));
    };
    let changed = lock(&s.auth).change_own(&user.name, &stored, new_hash, token);
    changed
        .map(|u| json(200, &u.view()))
        .map_err(|(status, why)| fail(status, why))
}

/// `POST /api/users`: a new user.
async fn create(s: &Arc<Shared>, req: Request<Incoming>) -> Result<Response<Out>, Fail> {
    let fields = ["name", "role", "password"];
    let b = body(req, &fields, &fields).await?;
    let name = b["name"].clone();
    if !auth::valid_name(&name) {
        return Err(fail(
            400,
            "a name has 1 … 64 characters A-Z a-z 0-9 . _ @ -",
        ));
    }
    let role = Role::parse(&b["role"]).ok_or_else(|| fail(400, "the role is admin or user"))?;
    let password = b["password"].clone();
    auth::check_password(&name, &password).map_err(|why| fail(400, why))?;
    let iterations = lock(&s.auth).iterations;
    let hash = hashing(s, move || auth::hash(&password, iterations)).await?;
    let created = lock(&s.auth).create(&name, role, hash);
    created
        .map(|u| json(201, &u.view()))
        .map_err(|(status, why)| fail(status, why))
}

/// `PUT /api/users/{name}`: the role and/or a new password.
async fn update(
    s: &Arc<Shared>,
    name: &str,
    req: Request<Incoming>,
) -> Result<Response<Out>, Fail> {
    let b = body(req, &["role", "password"], &[]).await?;
    if b.is_empty() {
        return Err(fail(400, "role or password"));
    }
    let role = match b.get("role") {
        Some(r) => Some(Role::parse(r).ok_or_else(|| fail(400, "the role is admin or user"))?),
        None => None,
    };
    let hash = match b.get("password").cloned() {
        Some(p) => {
            auth::check_password(name, &p).map_err(|why| fail(400, why))?;
            let iterations = lock(&s.auth).iterations;
            Some(hashing(s, move || auth::hash(&p, iterations)).await?)
        }
        None => None,
    };
    let updated = lock(&s.auth).update(name, role, hash);
    updated
        .map(|u| json(200, &u.view()))
        .map_err(|(status, why)| fail(status, why))
}

/// The messages of an event stream (see [`api::Stream`]) until the client
/// goes or its session ends; one that does not read ends its connection.
async fn produce(s: Arc<Shared>, tx: mpsc::Sender<Bytes>, end: Arc<Notify>, token: String) {
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
        let alive = lock(&s.auth).session(&token, Instant::now()).is_some();
        if !alive {
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

    /// Without a session `401`; the login (plain: the cookie without
    /// `Secure`); the session by cookie. The token.
    fn login_over_loopback(api: SocketAddr) -> String {
        let r = exchange(api, "GET /api/assets HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 401 "), "{r}");
        assert!(
            r.to_ascii_lowercase()
                .contains("www-authenticate: bearer realm=\"oec-registry\""),
            "{r}"
        );
        let login = |password: &str| {
            let body = format!(r#"{{"name":"admin","password":"{password}"}}"#);
            exchange(
                api,
                &format!(
                    "POST /api/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                ),
            )
        };
        assert!(login("wrong horse battery").starts_with("HTTP/1.1 401 "));
        let r = login("correct horse battery");
        assert!(r.starts_with("HTTP/1.1 200 OK\r\n"), "{r}");
        assert!(
            r.contains("set-cookie: oec_session=")
                && r.contains("; Path=/; HttpOnly; SameSite=Strict")
                && !r.contains("Secure"),
            "{r}"
        );
        let token = r
            .split(r#""token":""#)
            .nth(1)
            .and_then(|t| t.split('"').next())
            .unwrap()
            .to_owned();
        let r = exchange(
            api,
            &format!(
                "GET /api/session HTTP/1.1\r\nHost: localhost\r\nCookie: a=b; oec_session={token}\r\n\r\n"
            ),
        );
        assert!(
            r.starts_with("HTTP/1.1 200 OK\r\n") && r.contains(r#""role":"admin""#),
            "{r}"
        );
        token
    }

    /// The server over loopback (plain; TLS: the Go tests): the views, the
    /// headers, the guards, the login and the event stream.
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
        let root = crate::auth::tests::temp("http");
        let file = root.join("password");
        std::fs::write(&file, "correct horse battery\n").unwrap();
        let (auth, _) = Auth::open(&root, &file, true, crate::auth::tests::FAST).unwrap();
        start(
            listeners,
            None,
            Hosts::new([], false),
            KEEP_ALIVE,
            dir,
            auth,
        )
        .unwrap();
        let token = login_over_loopback(api);
        let get = |addr: SocketAddr, path: &str| {
            exchange(
                addr,
                &format!(
                    "GET {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\r\n"
                ),
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
            "GET /api/users/admin HTTP/1.1\r\nHost: localhost\r\n\r\n",
        );
        assert!(r.starts_with("HTTP/1.1 405 "), "{r}");
        assert!(r.to_ascii_lowercase().contains("allow: put, delete"), "{r}");
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
