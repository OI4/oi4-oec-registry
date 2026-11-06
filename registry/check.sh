#!/bin/sh
# Checks of the OEC Registry D5 of P7 (ADR-0029 §11), offline, no Docker:
#   rust (own Cargo package on the SDK crate oec, own Cargo.lock, A-380):
#   cargo fmt --check, clippy (pedantic, warnings are errors), cargo test
#   (the directory rules, the bus side incl. the read-only source scan and
#   the settings, the AsyncAPI document against the vendored AsyncAPI 3.1.0
#   meta-schema and the topic forms of the SDK core, the HTTP side: router,
#   guards, views, event stream, settings, a loopback server, the OpenAPI
#   document against the vendored OpenAPI 3.2 meta-schema, its paths = the
#   router, its schemas validating the views, the embedded Web UI table =
#   ui/dist/), cargo-deny with the
#   deny.toml of the SDK (ADR-0023), the binary (target/debug/oec-registry);
#   go (module oec/registry, standard library only, A-387): gofmt, go vet,
#   go test -race – the registry against the in-process TLS test broker
#   go-testbroker of oec/sdk/rust, judged by D8 `oec-infra bus --tests
#   T8-BUS-03` and D7 `oec-check test --level 3` with pinned passes, its
#   topics and subscriptions checked against api/asyncapi.json, its
#   ReferenceDesignation across a restart (oec-check and oec-infra of
#   oec/conformance built into a temporary directory and run, not
#   imported: ADR-0006); the HTTP side on loopback ports (ADR-0029 §7):
#   HTTPS with a self-signed and with the application certificate, plain
#   only with OEC_REGISTRY_TLS=off, REST, the event stream, the documents,
#   guards, limits, time limits, keep-alive and the settings, the files
#   of the Web UI over HTTPS; the Web UI without node and network
#   (internal/uipolicy, ADR-0029 §10): package.json and the lockfile v3
#   (exact versions, registry.npmjs.org, sha512 integrity, licenses of the
#   allowlist, shipped = react, react-dom, scheduler), the CSP rules of
#   ui/dist/ and the committed ui/build.stamp and src/ui_assets.rs. The npm
#   build is opt-in: ui/build.sh.
# Needs cargo-deny. OEC_REGISTRY_REQUIRE=1 (default here): a missing helper
# fails instead of skipping.
set -eu
root="$(cd "$(dirname "$0")" && pwd)"
rust="$root/../sdk/rust"

echo "registry: go-testbroker"
(cd "$rust" && cargo build --offline --locked --quiet -p oec-ffi --example go-testbroker)
target="$(cd "$rust" && cargo metadata --offline --locked --format-version 1 --no-deps | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"

echo "registry/rust: cargo fmt, clippy, test, deny (deny.toml of the SDK), build"
cd "$root"
cargo fmt --check
cargo clippy --offline --locked --all-targets --quiet -- -D warnings
cargo test --offline --locked --quiet
command -v cargo-deny >/dev/null || { echo "cargo-deny missing: cargo install cargo-deny --locked" >&2; exit 1; }
cargo deny --log-level error --config "$rust/deny.toml" check || {
	echo "cargo deny: retrying with the cached advisory DB (no network?)" >&2
	cargo deny --log-level error --config "$rust/deny.toml" --frozen check
}
cargo build --offline --locked --quiet

echo "registry/go: gofmt, vet, oec-check, oec-infra, go test -race (D8 T8-BUS-03, D7 level 3, HTTP)"
unformatted="$(gofmt -l .)"
test -z "$unformatted" || { echo "gofmt needed: $unformatted" >&2; exit 1; }
go vet ./...
tmp="$(mktemp -d)"
(cd "$root/../conformance" && go build -o "$tmp/oec-check" ./cmd/oec-check &&
	go build -o "$tmp/oec-infra" ./cmd/oec-infra) || { rm -rf "$tmp"; exit 1; }
OEC_REGISTRY_REQUIRE="${OEC_REGISTRY_REQUIRE:-1}" OEC_TESTBROKER="$target/debug/examples/go-testbroker" \
	OEC_REGISTRY="$root/target/debug/oec-registry" OEC_D7="$tmp/oec-check" \
	OEC_D8="$tmp/oec-infra" go test -race -count=1 ./... || { rm -rf "$tmp"; exit 1; }
rm -rf "$tmp"
echo "registry: ok"
