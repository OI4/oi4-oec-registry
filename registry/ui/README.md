# OEC Registry Web UI

The Web UI of the OEC Registry (ADR-0029 §9, §10): React 19, TypeScript 7,
Vite 7, built into `dist/` and embedded in the registry binary. See
`../README.md` ("Web UI") for the content, the build and the gate.

```sh
./build.sh   # opt-in: npm ci --ignore-scripts, tsc --noEmit + vite build,
             # build.stamp and ../src/ui_assets.rs
```

Never commit `node_modules/`. A change of a dependency follows the npm
policy of ADR-0029 §10: exact versions, `package-lock.json` v3, packages
only from `registry.npmjs.org`, licenses only of the allowlist of ADR-0023.
