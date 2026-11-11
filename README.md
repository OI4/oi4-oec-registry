# OI4 Open Edge Computing 2.0 – OEC Registry

The OEC Registry collects the `MAM` and `Health` of every participant on the
OI4 Message Bus and offers the available assets with the Registry services
of the OEC Messaging Guideline (annex A1). It is an OEC application itself:
Rust on the crate `oec`, ServiceType `Registry`, Messaging Level 3,
**read-only** towards the other participants (it only subscribes and sends
`Get`).

| Interface | What it offers |
|---|---|
| Message bus | `Get/MAM[/<Source>]`, `Get/Health[/<Source>]` and its own `Config` |
| HTTPS `5798` | Web UI (React/TypeScript, embedded in the binary) and the REST API `/api` with Server-Sent Events – login required (users with the roles `admin` and `user`, sessions) |
| HTTPS `5799` | the REST API `/api` only (login required) |
| API documents | [`registry/api/openapi.json`](registry/api/openapi.json) (REST), [`registry/api/asyncapi.json`](registry/api/asyncapi.json) (MQTT) |

Guide: [OEC Registry](https://oi4.github.io/oi4-oec-documentation/docs/community/registry)
in the Community section of the OEC guideline site. Details, configuration,
image and checks: [`registry/README.md`](registry/README.md).

## Where the registry comes from

The registry is developed in the OEC source tree, in the folder
`oec/registry`, together with the SDKs, the JSON Schemas and the compliance
tools D7/D8 that build and check it. This repository holds an **unmodified
copy of that folder** as `registry/`: it is laid out like the OEC source
tree, but contains only the registry. Paths in the copied files that leave
`registry/` (`../sdk/…`, `../schema/…`, `../conformance/…`, `../dev/…`, the
image build context `oec/` with its `.dockerignore`) refer to the OEC
source tree.

Changes are made in `oec/registry` of the OEC source tree and copied here;
do not edit `registry/` in this repository.

## Build and run

The registry needs the Rust SDK (`oec`, `oec-core`), the JSON Schemas and,
for the tests, D7/D8 and the test broker – all of them in the OEC source
tree. Build and test it there:

```sh
oec/registry/check.sh   # fmt, clippy, unit tests, cargo-deny, Web UI policy, integration tests with D7/D8
```

How to start it against a broker, the container image `oi4/oec-registry`
and the compose profile `registry` of the local development environment are
described in [`registry/README.md`](registry/README.md).

## Earlier versions

The OEC 1.x registry (TypeScript, namespace `Oi4`) is in the history of this
repository. OEC 2.0 (namespace `Oi4v2`) is not compatible with 1.x.

## License

MIT, see [`LICENSE`](LICENSE).
