# OEC Registry – D5 (Rust on `oec`)

The OEC Registry of P7 (ADR-0029, Q-035): it collects the `MAM` and
`Health` of every participant on the OI4 Message Bus and offers the
available assets with the Registry services of MG A1 – `Get/MAM[/<Source>]`
and `Get/Health[/<Source>]` on its own AppId. Step 1 is **read-only**
(ADR-0008): towards others it only subscribes and sends `Get`, never `Set`,
`Del` or `Call`. ServiceType `Registry`, product `oi4.org` / `OEC Registry`
/ `OEC-REGISTRY`, SerialNumber = the hostname of the container.

State (C-091, P7 exit run after the six increments of the P7 cycle cut in
`project/ROADMAP.md`):
Messaging Level 3. The registry collects `MAM`, `Health`, `Profile`,
`Event`, `PublicationList` and `SubscriptionList` of every participant
(raw subscriptions of the SDK, ADR-0026 §23), asks with `Get` for what is
missing (once per online period and `GetInterval`), keeps the publisher
relation and the devices, an observed Messaging level (informative) and a
conformity view (every received message validated with the strict D1
schemas, independent of D7). It has its own `Config` (below) and a
persistent `ReferenceDesignation`; D7 `oec-check test --level 3` passes.
Since C-088 it serves the directory over **HTTPS**, read-only (below);
since C-089 the **Web UI** (React/TypeScript/Vite, `ui/`) on the web port;
since C-090 the **image** `oi4/oec-registry` (below) and the compose profile
`registry` of `oec/dev`. C-091 ran the P7 exit (image with D8 `image`,
`run` and `container` at `--level 3`; compose run in which the registry
lists every participant over REST and in the Web UI) and added the guide
page [OEC Registry](https://oi4.github.io/oi4-oec-documentation/docs/community/registry) (since C-100 addendum 2 in the
Community section of the guideline site, `oi4-oec-documentation/docs/community/registry/index.md`).
Next: the PO decides on closing P7.

### Config `registry`

Group `directory`, read by the worker at least once a second. A `Set`
with a value out of range is refused by the SDK with `BadOutOfRange` (the
range is the `Validation` of the Config definition); the worker clamps
what it reads as a second line of defence:

| Setting | Default | Range | Meaning |
|---|---|---|---|
| `GetInterval` | 10 s | 1 … 3600 | least time between two `Get` of a resource of a participant |
| `GetTimeout` | 5 s | 1 … 60 | time an answer may take |
| `HealthHistory` | 20 | 0 … 1000 | kept `Health` changes per asset |
| `EventTrail` | 200 | 0 … 10000 | kept `Event`s of all participants |
| `ViolationTrail` | 10 | 0 … 1000 | kept schema violations per participant |

## HTTP: REST, SSE, TLS (ADR-0029 §7)

Read-only (ADR-0008): every resource answers `GET` only, any other method
(also `HEAD`, `OPTIONS`) `405` with `Allow: GET`. Described in
`api/openapi.json` (OpenAPI 3.2.0).

| Path | Content |
|---|---|
| `GET /api/assets` | the registry, its limits, the ignored messages and a summary per asset (kind, publisher, availability, MAM, latest Health, observed level, conformity counts, devices) |
| `GET /api/assets/{il}` | the summary plus the detail (Profile, Health history, answers to the `Get`s, PublicationList, SubscriptionList, last violations); `{il}` percent-encoded as one segment; `404` if unknown |
| `GET /api/events` | the Event trail, oldest first, with a sequence number |
| `GET /api/stream` | `text/event-stream`: a `snapshot`, then `asset`, `event` and `directory` messages; a `keep-alive` comment when quiet |
| `GET /api/openapi.json`, `GET /api/asyncapi.json` | the API documents |
| `GET /`, `GET /<file of ui/dist>` | web port only: the Web UI (below); other paths `404` |

| Variable | Default | Meaning |
|---|---|---|
| `OEC_REGISTRY_WEB` | `0.0.0.0:5798` | Web UI and `/api` (MG A1 default port); empty = off |
| `OEC_REGISTRY_API` | `0.0.0.0:5799` | `/api` only; empty = off |
| `OEC_REGISTRY_TLS` | `on` | `off` = plain HTTP, for development only (a warning is logged) |
| `OEC_REGISTRY_HOSTS` | – | further host names, comma separated: allowed in `Host` and, when self-signed, in the certificate |
| `OEC_REGISTRY_KEEPALIVE_MS` | `15000` | keep-alive comment of an idle stream, 1 … 15000 |

**TLS:** if the registry authenticates at the Message Bus with its
application certificate (`/etc/oi4/certs/<containername>.pem`, key in
`/run/secrets/oi4`, RIG 4.1.2/4.1.3), both ports present it; otherwise it
signs a certificate itself at the start (ECDSA P-256, in memory only, SANs
`localhost`, the container name, `OEC_REGISTRY_HOSTS`, `127.0.0.1`, `::1`).
The certificate is read at the start: a rotated one takes effect with the
next start. Invalid settings or a taken port end the start with a message
before the registry connects to the broker.

**Hardening** (ADR-0028 amendment C-083, no authentication: the API is
read-only): `Host` must be `localhost`, the container name, a name of
`OEC_REGISTRY_HOSTS` or an IP literal (DNS rebinding); a cross-site
`Origin` is refused (`403`); `Transfer-Encoding` `501`, `Content-Length`
over 64 KiB `413`, header over 8 KiB `431`; at most 16 connections and 8
streams (more: `503`); 5 s for the TLS handshake and the request head,
10 s for a response; `Connection: close` (one request per connection, but
streams); `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, a
restrictive CSP, `Referrer-Policy: no-referrer`.

## Web UI (ADR-0029 §9, §10)

A single page on the web port (`https://<host>:5798/`), read-only and live
over `/api/stream`, in the colours of the Open Industry 4.0 Alliance
(green `#76B82A`, navy `#061520`; light and dark theme, following the
system or chosen in the app bar):

- **Key figures**: applications, devices, assets that need attention
  (offline, Health not `NORMAL_0` or schema violations) and Events; a click
  filters the list or opens the Event trail.
- **Asset list**: the applications with their devices (collapsible), search
  over name, IL, ServiceType and manufacturer, filter (all, applications,
  devices, attention) and sort (name, Health, last seen).
- **Overview** (nothing selected): Health distribution, the assets that
  need attention, ServiceTypes, observed levels, the latest Events and the
  registry itself.
- **Asset detail** with the tabs Overview (availability, latest Health and
  its history, observed Messaging level, devices), Nameplate (MAM),
  Interfaces (Profile, the answers to the `Get`s, PublicationList with
  filter by resource, SubscriptionList), Conformity (informative, with the
  missing REQs and the last violations) and Events.
- **Event trail** (`#/events`): search, severity (Syslog level, the class of
  the StatusCode of a Status Event), category, pause.

Hash routes `#/asset/<IL>[/<tab>]` and `#/events` (bookmarkable); `/`
focuses the search, `Esc` closes the detail. No other origin: the CSP
`default-src 'self'` holds without `unsafe-inline` (no `style` props, bars
are SVG). The OI4 signet is a simplified own SVG drawing, not the official
logo.

React 19.3.1 + react-dom, TypeScript 7.0.2, Vite 7.3.7 (not Vite 8:
`lightningcss` is MPL-2.0, A-382); JSX through esbuild, no
`@vitejs/plugin-react`. The built `ui/dist/` is committed and embedded in
the binary (`src/ui_assets.rs`, generated: `include_bytes!` per file, the
content type by extension), so neither the build of the registry nor the
gate needs node or the network.

After a change of `ui/` (opt-in, needs node ≥ 22.12 and the network):

```sh
oec/registry/ui/build.sh   # npm ci --ignore-scripts, tsc --noEmit + vite build,
                           # then ui/build.stamp and src/ui_assets.rs
```

The gate (`internal/uipolicy`, standard library only) checks without node:
`package.json` (private, exact versions, only the script `build`) and
`package-lock.json` v3 (every package from `registry.npmjs.org` with a
sha512 `integrity`, licenses of the allowlist of ADR-0023, shipped = react,
react-dom, scheduler), the CSP rules of `ui/dist/` (no inline script,
style or handler, only own files, no source map) and that the committed
`ui/build.stamp` (sha256 of every input and every built file) and
`src/ui_assets.rs` are current – a changed source without a new `dist/`
fails.

## Build and run

An own Cargo package outside the SDK workspace with its own `Cargo.lock`;
`oec` is a path dependency (`../sdk/rust/oec`):

```sh
cd oec/registry
cargo build --offline --locked          # target/debug/oec-registry
OEC_ROOT=<container storage root> target/debug/oec-registry
```

The broker, the credentials and the identity come from the container
storage under `OEC_ROOT` (default `/`) through the SDK: `broker.json`,
`/etc/oi4/mqtt/…`, `/run/secrets/oi4` (REQ-CNT-003, GL-ADR-022). Run it on
a **copy** of an example storage, never on `oec/dev/generated/` itself.
`OEC_REGISTRY_LOG` = `error`, `warn`, `info` (default) or `debug` sets the
log on stderr; `info` reports "N of M assets available" after every change.

## Image (ADR-0029 §12)

`Dockerfile` (build context `oec/`, allowlist `oec/.dockerignore`), as the
demo images (ADR-0028 §4): the build stage runs on the build platform and
cross-compiles for linux/amd64 and linux/arm64 (`rust:1.89-trixie`,
`golang:1.27.3-trixie` for the SBOM tool); the runtime base is
`gcr.io/distroless/cc-debian13:nonroot` – all pinned by tag and digest. The
final stage has no `RUN`: `/usr/local/bin/oec-registry`, user 65532,
volumes `/etc/oi4/app` and `/opt/oi4/app`, ports 5798 (Web UI and API) and
5799 (API), `OEC_REGISTRY_WEB=0.0.0.0:5798`, `OEC_REGISTRY_API=0.0.0.0:5799`.
TLS is on: with a client certificate in the container storage the registry
serves HTTPS with it, otherwise with a self-signed certificate (above).

**The Web UI is not built in the image:** the committed, stamped `ui/dist/`
is embedded through `src/ui_assets.rs`; there is no node in any stage.
`/opt/oi4/licenses` holds the SBOM (`sbom.spdx.json`, SPDX 2.3) and the
license texts: the crates linked into the binary (`cargo tree`), the Rust
standard library, the Debian packages of the base and the npm packages of
the bundle – `react`, `react-dom`, `scheduler` (MIT), read from
`ui/package-lock.json` (the non-dev packages, the same rule as
`internal/uipolicy`).

```sh
images/build.sh /tmp/oec-registry   # opt-in: buildx (amd64 + arm64), D8 image + run at --level 3, load
images/build.sh --remove            # remove the loaded image
```

`images/build.sh` uses an own buildx builder with the pinned BuildKit of the
demos and removes it (and a BuildKit image it pulled) at the end; nothing is
pruned. `image_test.go` checks the Dockerfile, the `.dockerignore` and the
script offline (gate). To read the SBOM of a loaded image:
`docker create --name x oi4/oec-registry:0.1.0 && docker cp x:/opt/oi4/licenses /tmp/l && docker rm -v x`
(`-v`: the image declares volumes). With a broker: the compose profile
`registry` of [`../dev`](../dev/README.md#compose-profile-registry-c-090).

## Layout

| Path | Content |
|---|---|
| `src/main.rs` | wiring: identity, level, log, the SDK application |
| `src/directory.rs` | the directory: sans-IO rules of ADR-0029 §3 with unit tests |
| `src/api.rs` | the HTTP API, sans-IO: router, guards, JSON views of the directory, the stream messages |
| `src/http.rs` | the HTTP server on hyper 1: listeners, TLS, limits, timeouts, the stream |
| `src/tls.rs` | the TLS identity: application certificate or self-signed (rcgen) |
| `src/ui_assets.rs` | generated: the files of `ui/dist/` embedded (`include_bytes!`) with their content types |
| `ui/` | the Web UI: `src/` (React/TypeScript), `index.html`, `public/`, `package.json`, `package-lock.json`, `vite.config.mjs`, `tsconfig.json`; `dist/` and `build.stamp` committed; `build.sh` (opt-in) |
| `internal/uipolicy/` | the npm policy, the CSP rules, the stamp and the table (gate); `cmd/uigen` writes the stamp and the table |
| `src/bus.rs` | the `Config`, the raw subscriptions, the conformity check, the worker that feeds the directory, `Get` of what is missing, listing in the SDK; a source scan asserts that no `Set`/`Del`/`Call` is sent |
| `src/api_tests.rs` | the AsyncAPI document against its meta-schema, its channels against the topic forms of the SDK core (`Form::of`) and the collected resources, its operations read-only; the OpenAPI document against its meta-schema, its paths = the router, the views against its response schemas |
| `api/openapi.json` | OpenAPI 3.2.0: the REST API and the event stream (`itemSchema`); MG payloads reference the D1 schemas by `$id` |
| `api/asyncapi.json` | AsyncAPI 3.1.0: the MQTT interface (Registry services, lifecycle, collecting subscriptions, `Get`s to others); payloads reference the D1 schemas by `$id` |
| `api/meta/` | the AsyncAPI 3.1.0 JSON Schema, vendored from `asyncapi/spec-json-schemas` (commit `eee8d22`, `schemas/3.1.0.json`, Apache-2.0, license file beside it); the OpenAPI 3.2 schema iteration `2026-08-30`, vendored from `https://spec.openapis.org/oas/3.2/schema/2026-08-30` (OpenAPI Initiative, Apache-2.0, license file beside it) |
| `registry_test.go`, `internal/regtest/` | Go integration tests (module `github.com/OI4/oec/registry`, standard library only): the registry on the in-process TLS test broker, judged by D8 and D7, and its HTTP side |
| `Dockerfile`, `images/build.sh`, `image_test.go` | the image (ADR-0029 §12), its opt-in build with D8 and its offline test |
| `check.sh` | step 8 of `oec/check.sh` |

## Checks

`./check.sh` (offline, no Docker): `cargo fmt --check`, clippy (pedantic,
warnings are errors), `cargo test`, `cargo deny` with the `deny.toml` of
the SDK, the build; then `gofmt`, `go vet` and `go test -race` with
`go-testbroker` of `oec/sdk/rust` and `oec-check`/`oec-infra` of
`oec/conformance` built into a temporary directory (run, not imported:
ADR-0006):

- `TestD8Registry`: `oec-infra bus --tests T8-BUS-03` passes (REQ-REG-001,
  REQ-REG-002); the registry subscribes to `Oi4v2/+/+/Pub/<R>/#` for the
  six collected resources, and its topics and subscriptions on the wire
  are channels of `api/asyncapi.json`.
- `TestD7Level3`: `oec-check test --level 3` – no fail, 49 pinned passes,
  the wire again against `api/asyncapi.json`; T7-GET-04, T7-SET-03 and
  T7-MON-04 treat only the registry itself as an entity (A-388).
- `TestReferenceDesignationPersists`: a `Set` of the ReferenceDesignation
  survives a restart on the same storage.
- `TestHTTPSelfSigned`, `TestHTTPApplicationCertificate`, `TestHTTPPlain`,
  `TestHTTPSettings` (`http_test.go`): TLS with a self-signed or the
  application certificate on both ports, plain only with `TLS=off`; every
  OpenAPI path, the views and the stream with a participant on the bus;
  the guards, limits, timeouts and keep-alive of the hardening contract;
  invalid settings; every file of the Web UI over HTTPS with its bytes,
  content type and headers on the web port, `404` on the API port. The
  D8/D7/RD runs keep HTTP off (`regtest.HTTPOff`).
- `internal/uipolicy` `TestUI`, `TestViolations`, `TestWrite`: the npm
  policy, the stamp and the table of the committed UI, and 31 violations
  on a copy.
- `internal/regtest` `TestAPI`: the channel patterns of the AsyncAPI.
- `TestDockerfile`, `TestDockerignore`, `TestBuildScript` (`image_test.go`):
  the pinned images, the final stage without `RUN`, user, volumes, ports,
  no node, the SBOM with `-npm`; the build context; the D8 levels and the
  clean-up of `images/build.sh`.

`OEC_REGISTRY_D7_REPORT=<file>` keeps the D7 report of the run.
