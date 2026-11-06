# syntax=docker/dockerfile:1
# Image of the OEC Registry D5 (ADR-0029 §12, amendment C-090):
# oi4/oec-registry. Build context: oec/ (see oec/.dockerignore), for
# linux/amd64 and linux/arm64 with docker buildx (oec/registry/images/build.sh):
#
#   docker buildx build -f registry/Dockerfile --platform linux/arm64 \
#     -t oi4/oec-registry:0.1.0 --load oec
#
# As the demo images (ADR-0028 §4): the build stage runs on the build
# platform and cross-compiles (Debian cross toolchains, no emulation); the
# final stage has no RUN; the images are pinned by tag and digest. The Web UI
# is not built here: the reviewed and stamped ui/dist/ is embedded by
# src/ui_assets.rs (ADR-0029 §10, A-411), so there is no node in any stage;
# the SBOM lists the npm packages of the bundle from ui/package-lock.json.
ARG RUST_IMAGE=docker.io/library/rust:1.89-trixie@sha256:57407b378b2b6e07b48a6135a20c87cc22ea6e249c0acf6cb1833ead3cf116e9
ARG GO_IMAGE=docker.io/library/golang:1.27.3-trixie@sha256:c65ecfe613b539ac74c62a4c3b2c27e8f8a6076384c8f27e8a3c0f3be17cc385
ARG BASE_IMAGE=gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go

# the runtime base of the target platform: its package database feeds the SBOM
FROM ${BASE_IMAGE} AS base

FROM --platform=$BUILDPLATFORM ${RUST_IMAGE} AS build
ARG TARGETARCH
ARG VERSION=0.1.0
ARG SOURCE_DATE_EPOCH
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH GOTOOLCHAIN=local GOFLAGS=-buildvcs=false \
	CARGO_TARGET_DIR=/tmp/target \
	CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
	CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
	CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
	CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
RUN case "$TARGETARCH" in amd64) cpu=x86_64 ;; arm64) cpu=aarch64 ;; *) echo "unsupported: $TARGETARCH" >&2; exit 1 ;; esac && \
	echo "$cpu" >/tmp/cpu && \
	apt-get update -qq && \
	apt-get install -y -qq --no-install-recommends "gcc-$(echo $cpu | tr _ -)-linux-gnu" "libc6-dev-$TARGETARCH-cross" >/dev/null && \
	rm -rf /var/lib/apt/lists/* && \
	rustup target add "$cpu-unknown-linux-gnu"
COPY --from=base /var/lib/dpkg/status.d /base/var/lib/dpkg/status.d
COPY --from=base /usr/share/doc /base/usr/share/doc
COPY --from=base /usr/lib/os-release /base/usr/lib/os-release
COPY schema /src/schema
COPY sdk/rust /src/sdk/rust
# the SBOM tool of the demo images, its Debian license map and license texts
COPY demos/go.mod /src/demos/go.mod
COPY demos/internal/sbom /src/demos/internal/sbom
COPY demos/images/debian.json /src/demos/images/debian.json
COPY demos/images/licenses /src/demos/images/licenses
COPY registry /src/registry
WORKDIR /src
RUN cpu="$(cat /tmp/cpu)" && t="$cpu-unknown-linux-gnu" && \
	cargo build --locked --release --target "$t" --manifest-path registry/Cargo.toml && \
	mkdir -p /out/app && \
	"$cpu-linux-gnu-strip" -o /out/oec-registry "/tmp/target/$t/release/oec-registry" && \
	cargo tree --locked --manifest-path registry/Cargo.toml -p oec-registry --target "$t" \
		--edges normal,no-proc-macro --prefix none --format '{p}|{l}' >/tmp/cargo-tree.txt && \
	cd demos && go run ./internal/sbom/cmd/oec-sbom -name oec-registry -version "$VERSION" \
		-cargo /tmp/cargo-tree.txt -rust "$(rustc --version | cut -d' ' -f2)" \
		-npm /src/registry/ui/package-lock.json \
		-base /base -debian images/debian.json -texts images/licenses -out /out/licenses

FROM ${BASE_IMAGE}
ARG VERSION=0.1.0
LABEL org.opencontainers.image.title="oec-registry" \
	org.opencontainers.image.description="OI4 OEC v2.0 D5: OEC Registry with HTTP API and Web UI (Rust on the OEC Rust SDK)" \
	org.opencontainers.image.version="${VERSION}" \
	org.opencontainers.image.licenses="MIT" \
	org.opencontainers.image.vendor="OI4 Alliance" \
	org.opencontainers.image.source="https://github.com/OI4/oec" \
	org.opencontainers.image.base.name="gcr.io/distroless/cc-debian13:nonroot"
COPY --from=build /out/oec-registry /usr/local/bin/oec-registry
COPY --from=build /out/licenses/ /opt/oi4/licenses/
COPY --from=build --chown=65532:65532 /out/app/ /etc/oi4/app/
COPY --from=build --chown=65532:65532 /out/app/ /opt/oi4/app/
VOLUME ["/etc/oi4/app", "/opt/oi4/app"]
ENV OEC_REGISTRY_WEB=0.0.0.0:5798 OEC_REGISTRY_API=0.0.0.0:5799
EXPOSE 5798 5799
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/oec-registry"]
