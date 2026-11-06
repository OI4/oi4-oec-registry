package registry

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The image of the registry (ADR-0029 §12, amendment C-090), checked
// offline as the demo images (oec/demos/images_test.go): the opt-in build
// itself needs Docker and runs in images/build.sh.

// pinned is an image reference by tag and digest.
var pinned = regexp.MustCompile(`^[a-z0-9.-]+(?:/[a-z0-9._-]+)+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$`)

// instruction is one Dockerfile instruction with its continuation lines.
type instruction struct {
	cmd, args string
}

func dockerfile(t *testing.T, path string) []instruction {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out []instruction
	var cur strings.Builder
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if cur.Len() == 0 && (line == "" || strings.HasPrefix(line, "#")) {
			continue
		}
		if strings.HasSuffix(line, "\\") {
			cur.WriteString(strings.TrimSuffix(line, "\\") + " ")
			continue
		}
		cur.WriteString(line)
		cmd, args, _ := strings.Cut(cur.String(), " ")
		out = append(out, instruction{strings.ToUpper(cmd), strings.TrimSpace(args)})
		cur.Reset()
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// tool is a JavaScript tool run as a command (not the -npm flag of oec-sbom).
var tool = regexp.MustCompile(`(^|[\s;&|(])(npm|npx|node|yarn|pnpm|vite|corepack)(\s|$)`)

// imageArgs are the pinned image ARGs of a Dockerfile.
func imageArgs(ins []instruction) map[string]string {
	out := map[string]string{}
	for _, in := range ins {
		if k, v, ok := strings.Cut(in.args, "="); in.cmd == "ARG" && ok && strings.HasSuffix(k, "_IMAGE") {
			out[k] = v
		}
	}
	return out
}

// The Dockerfile follows ADR-0028 §4 as the demos: the same builder and
// base images, pinned by tag and digest (those of the config service, the
// other Rust image); every FROM is one of them or an own stage; the final
// stage is the base image without RUN, runs as the fixed non-root user
// 65532:65532, declares the volumes /etc/oi4/app and /opt/oi4/app, copies
// the SBOM and the license texts to /opt/oi4/licenses (RIG 4.1.4), listens
// on 0.0.0.0:5798 (Web UI and API) and 0.0.0.0:5799 (API) (REQ-REG-007),
// carries the OCI labels and no ADD, no secret and no key material. The Web
// UI is embedded, not built: no node or npm in any stage; the SBOM gets
// the npm packages of the bundle from ui/package-lock.json.
func TestDockerfile(t *testing.T) {
	ins := dockerfile(t, "Dockerfile")
	own := imageArgs(ins)
	for k, v := range own {
		if !pinned.MatchString(v) {
			t.Errorf("%s=%s: not pinned by tag and digest", k, v)
		}
	}
	demo := imageArgs(dockerfile(t, filepath.Join("..", "demos", "config", "Dockerfile")))
	if len(own) != 3 || len(demo) != 3 {
		t.Errorf("images %v, config service %v", own, demo)
	}
	for _, k := range []string{"RUST_IMAGE", "GO_IMAGE", "BASE_IMAGE"} {
		if own[k] == "" || own[k] != demo[k] {
			t.Errorf("%s=%s, the demos %s", k, own[k], demo[k])
		}
	}
	stages := map[string]bool{}
	var final []instruction
	var build strings.Builder
	for _, in := range ins {
		lower := strings.ToLower(in.args)
		switch in.cmd {
		case "FROM":
			f := strings.Fields(in.args)
			if len(f) > 0 && strings.HasPrefix(f[0], "--platform=") {
				f = f[1:]
			}
			ref := strings.Trim(f[0], "${}")
			if _, ok := own[ref]; !ok && !stages[f[0]] {
				t.Errorf("FROM %s: neither a pinned image ARG nor an own stage", in.args)
			}
			if len(f) == 3 && strings.EqualFold(f[1], "AS") {
				stages[f[2]] = true
			}
			final = nil
			if ref == "BASE_IMAGE" && len(f) == 1 {
				final = []instruction{in}
			}
			continue
		case "ADD":
			t.Errorf("ADD %s: use COPY", in.args)
		case "RUN":
			build.WriteString(in.args + "\n")
		}
		if final != nil {
			final = append(final, in)
		}
		for _, bad := range []string{"dev/generated", ".key", ".pem", "passwd", "secret", "password", "token", "node_modules"} {
			if strings.Contains(lower, bad) {
				t.Errorf("%s %s: mentions %q", in.cmd, in.args, bad)
			}
		}
		if tool.MatchString(lower) {
			t.Errorf("%s %s: the Web UI is embedded, not built in the image", in.cmd, in.args)
		}
	}
	for _, want := range []string{
		"cargo build --locked --release --target \"$t\" --manifest-path registry/Cargo.toml",
		"-npm /src/registry/ui/package-lock.json",
		"-name oec-registry",
	} {
		if !strings.Contains(build.String(), want) {
			t.Errorf("the build stage lacks %s", want)
		}
	}
	if final == nil {
		t.Fatal("the final stage is not FROM ${BASE_IMAGE}")
	}
	got := map[string][]string{}
	for _, in := range final[1:] {
		got[in.cmd] = append(got[in.cmd], in.args)
	}
	if len(got["RUN"]) > 0 {
		t.Errorf("RUN in the final stage: %v", got["RUN"])
	}
	want := map[string][]string{
		"USER":       {"65532:65532"},
		"VOLUME":     {`["/etc/oi4/app", "/opt/oi4/app"]`},
		"ENV":        {"OEC_REGISTRY_WEB=0.0.0.0:5798 OEC_REGISTRY_API=0.0.0.0:5799"},
		"EXPOSE":     {"5798 5799"},
		"ENTRYPOINT": {`["/usr/local/bin/oec-registry"]`},
	}
	for cmd, w := range want {
		if !slices.Equal(got[cmd], w) {
			t.Errorf("%s %q, want %q", cmd, got[cmd], w)
		}
	}
	copies := strings.Join(got["COPY"], "\n")
	for _, c := range []string{
		"--from=build /out/oec-registry /usr/local/bin/oec-registry",
		"--from=build /out/licenses/ /opt/oi4/licenses/",
		"--from=build --chown=65532:65532 /out/app/ /etc/oi4/app/",
		"--from=build --chown=65532:65532 /out/app/ /opt/oi4/app/",
	} {
		if !strings.Contains(copies, c) {
			t.Errorf("no COPY %s", c)
		}
	}
	labels := strings.Join(got["LABEL"], " ")
	for _, l := range []string{`title="oec-registry"`, `version="${VERSION}"`, `licenses="MIT"`, "source=", "vendor=", "base.name="} {
		if !strings.Contains(labels, "org.opencontainers.image."+l) {
			t.Errorf("no label org.opencontainers.image.%s", l)
		}
	}
}

// oec/.dockerignore lets in what the registry build needs – the crate, the
// API documents and the Web UI bundle it embeds, the lockfile of the bundle
// – and keeps out build output, node_modules, the UI sources and the
// generated storages and keys of oec/dev.
func TestDockerignore(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", ".dockerignore"))
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, l := range strings.Split(string(b), "\n") {
		if l = strings.TrimSpace(l); l != "" && !strings.HasPrefix(l, "#") {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 || lines[0] != "*" {
		t.Fatalf("not an allowlist (first pattern %q)", lines)
	}
	want := []string{"!registry/Cargo.toml", "!registry/Cargo.lock", "!registry/src", "!registry/api/openapi.json",
		"!registry/api/asyncapi.json", "!registry/ui/dist", "!registry/ui/package-lock.json"}
	var got []string
	for _, l := range lines {
		if strings.HasPrefix(l, "!registry") {
			got = append(got, l)
		}
	}
	if !slices.Equal(got, want) {
		t.Errorf("registry patterns %v, want %v", got, want)
	}
	for _, l := range []string{"**/target", "**/node_modules"} {
		if !slices.Contains(lines, l) {
			t.Errorf("no %s", l)
		}
	}
}

// images/build.sh runs the pinned BuildKit of the demos, removes its
// builder, never prunes, judges with D8 image and run at level 3 (the
// Service Container level of the registry, ADR-0016) and fails on any other
// verdict than pass.
func TestBuildScript(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("images", "build.sh"))
	if err != nil {
		t.Fatal(err)
	}
	d, err := os.ReadFile(filepath.Join("..", "demos", "images", "build.sh"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	re := regexp.MustCompile(`(?m)^buildkit="([^"]+)"$`)
	m, dm := re.FindStringSubmatch(s), re.FindStringSubmatch(string(d))
	if m == nil || dm == nil || !pinned.MatchString(m[1]) || m[1] != dm[1] {
		t.Fatalf("BuildKit %v: not the pinned one of the demos %v", m, dm)
	}
	for _, want := range []string{
		`--driver-opt "image=$buildkit"`, `docker buildx rm "$builder"`, `-f "$oec/registry/Dockerfile"`,
		`--platform linux/amd64,linux/arm64`, `oec-infra" image --level 3 `, `oec-infra" run --level 3 `,
		`docker image rm "$old"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("build.sh lacks %s", want)
		}
	}
	if regexp.MustCompile(`(?m)^[^#]*\bprune\b`).MatchString(s) {
		t.Error("build.sh must not prune")
	}
	if regexp.MustCompile(`(?m)^[^#]*(^|[\s;&|(])(npm|node)(\s|$)`).MatchString(s) {
		t.Error("build.sh must not build the Web UI (ui/build.sh does)")
	}
	if !regexp.MustCompile(`(?m)^\[ "\$d8" = 0 \] \|\| \{`).MatchString(s) {
		t.Error("build.sh must exit non-zero when a D8 run did not pass")
	}
}
