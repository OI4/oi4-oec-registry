// Package uipolicy is the offline gate of the Registry Web UI (ADR-0029 §9,
// §10, amendment C-089): the npm policy of package.json and
// package-lock.json (exact pins, lockfile v3, everything resolved from
// registry.npmjs.org with a sha512 integrity, licenses of the ADR-0023
// allowlist, shipped code React, react-dom and scheduler only), the build
// stamp (sha256 of every input and every built file), the CSP rules of the
// built files, and the generated Rust table of the embedded files. It needs
// neither node nor the network; standard library only.
package uipolicy

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Command writes the stamp and the table (run from oec/registry; ui/build.sh
// runs it after the build).
const Command = "go run ./internal/uipolicy/cmd/uigen"

// StampFile is the stamp of the build, relative to the UI directory.
const StampFile = "build.stamp"

// TableFile is the generated Rust table, relative to oec/registry.
const TableFile = "src/ui_assets.rs"

// Registry is the only source of packages.
const Registry = "https://registry.npmjs.org/"

// BuildScript is the only script of package.json.
const BuildScript = "tsc --noEmit && vite build"

// Licenses is the allowlist of ADR-0023 §2.
var Licenses = []string{"MIT", "MIT-0", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Zlib", "Unicode-3.0"}

// Dependencies are the direct runtime dependencies of package.json.
var Dependencies = []string{"react", "react-dom"}

// Shipped are the packages of the lockfile that are not build tools: the
// code in the bundle (ADR-0029 §9).
var Shipped = []string{"react", "react-dom", "scheduler"}

// Types are the content types of the built files by extension.
var Types = map[string]string{
	".html": "text/html; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".svg":  "image/svg+xml",
}

const sha512Size = 64

var (
	exact        = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
	inlineScript = regexp.MustCompile(`(?is)<script\b[^>]*>\s*[^<\s]`)
	inlineStyle  = regexp.MustCompile(`(?i)<style\b|\sstyle\s*=`)
	eventAttr    = regexp.MustCompile(`(?i)\son[a-z]+\s*=`)
	refAttr      = regexp.MustCompile(`(?i)\b(?:src|href)\s*=\s*["']?([^"'\s>]*)`)
	cssURL       = regexp.MustCompile(`(?i)url\(\s*['"]?([^'")]*)`)
)

type manifest struct {
	Name                 string            `json:"name"`
	Version              string            `json:"version"`
	Private              bool              `json:"private"`
	Scripts              map[string]string `json:"scripts"`
	Dependencies         map[string]string `json:"dependencies"`
	DevDependencies      map[string]string `json:"devDependencies"`
	OptionalDependencies json.RawMessage   `json:"optionalDependencies"`
	PeerDependencies     json.RawMessage   `json:"peerDependencies"`
	BundleDependencies   json.RawMessage   `json:"bundleDependencies"`
	BundledDependencies  json.RawMessage   `json:"bundledDependencies"`
	Overrides            json.RawMessage   `json:"overrides"`
	Workspaces           json.RawMessage   `json:"workspaces"`
}

type lockEntry struct {
	Name            string            `json:"name"`
	Version         string            `json:"version"`
	Resolved        string            `json:"resolved"`
	Integrity       string            `json:"integrity"`
	License         json.RawMessage   `json:"license"`
	Dev             bool              `json:"dev"`
	Link            bool              `json:"link"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
}

type lockfile struct {
	Name            string               `json:"name"`
	Version         string               `json:"version"`
	LockfileVersion int                  `json:"lockfileVersion"`
	Packages        map[string]lockEntry `json:"packages"`
}

// Package is one package of the lockfile.
type Package struct {
	Name, Version, License string
	// Shipped: not a build tool (not "dev").
	Shipped bool
}

func readJSON(file string, v any) error {
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(file), err)
	}
	return nil
}

func sameMap(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			return false
		}
	}
	return true
}

// license returns the license of an entry and whether every identifier of
// its SPDX expression is in the allowlist.
func license(raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) != nil || s == "" {
		return string(raw), false
	}
	for _, f := range strings.Fields(strings.NewReplacer("(", " ", ")", " ").Replace(s)) {
		if f != "OR" && f != "AND" && !slices.Contains(Licenses, f) {
			return s, false
		}
	}
	return s, true
}

// CheckPackages checks package.json and package-lock.json in ui and returns
// the packages of the lockfile (sorted by path) and every violation.
func CheckPackages(ui string) ([]Package, []error) {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }
	var m manifest
	if err := readJSON(filepath.Join(ui, "package.json"), &m); err != nil {
		return nil, []error{err}
	}
	var l lockfile
	if err := readJSON(filepath.Join(ui, "package-lock.json"), &l); err != nil {
		return nil, []error{err}
	}

	if !m.Private {
		fail("package.json: not private")
	}
	if len(m.Scripts) != 1 || m.Scripts["build"] != BuildScript {
		fail("package.json: scripts must be exactly {\"build\": %q} (no install scripts)", BuildScript)
	}
	for name, raw := range map[string]json.RawMessage{
		"optionalDependencies": m.OptionalDependencies, "peerDependencies": m.PeerDependencies,
		"bundleDependencies": m.BundleDependencies, "bundledDependencies": m.BundledDependencies,
		"overrides": m.Overrides, "workspaces": m.Workspaces,
	} {
		if raw != nil {
			fail("package.json: %s is not allowed", name)
		}
	}
	deps := make([]string, 0, len(m.Dependencies))
	for name := range m.Dependencies {
		deps = append(deps, name)
	}
	sort.Strings(deps)
	if !slices.Equal(deps, Dependencies) {
		fail("package.json: dependencies %v, want exactly %v (ADR-0029 §9)", deps, Dependencies)
	}
	direct := map[string]string{}
	for _, d := range []map[string]string{m.Dependencies, m.DevDependencies} {
		for name, v := range d {
			if !exact.MatchString(v) {
				fail("package.json: %s %q is not an exact version", name, v)
			}
			direct[name] = v
		}
	}

	if l.LockfileVersion != 3 {
		fail("package-lock.json: lockfileVersion %d, want 3", l.LockfileVersion)
	}
	root, ok := l.Packages[""]
	switch {
	case !ok:
		fail("package-lock.json: no root entry")
	case l.Name != m.Name || root.Name != m.Name || l.Version != m.Version || root.Version != m.Version ||
		!sameMap(root.Dependencies, m.Dependencies) || !sameMap(root.DevDependencies, m.DevDependencies):
		fail("package-lock.json: the root entry differs from package.json (run npm install)")
	}
	for name, v := range direct {
		if e, ok := l.Packages["node_modules/"+name]; !ok || e.Version != v {
			fail("package-lock.json: %s is not locked at %s", name, v)
		}
	}
	keys := make([]string, 0, len(l.Packages))
	for k := range l.Packages {
		if k != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var pkgs []Package
	var shipped []string
	for _, k := range keys {
		e := l.Packages[k]
		i := strings.LastIndex(k, "node_modules/")
		if !strings.HasPrefix(k, "node_modules/") {
			fail("package-lock.json: %s is not a package of node_modules", k)
			continue
		}
		name := k[i+len("node_modules/"):]
		if e.Link {
			fail("package-lock.json: %s is a link", k)
			continue
		}
		if !exact.MatchString(e.Version) {
			fail("package-lock.json: %s has no exact version (%q)", k, e.Version)
			continue
		}
		want := Registry + name + "/-/" + path.Base(name) + "-" + e.Version + ".tgz"
		if e.Resolved != want {
			fail("package-lock.json: %s is resolved from %q, want %q", k, e.Resolved, want)
		}
		sum, ok := strings.CutPrefix(e.Integrity, "sha512-")
		if b, err := base64.StdEncoding.DecodeString(sum); !ok || err != nil || len(b) != sha512Size {
			fail("package-lock.json: %s has no sha512 integrity (%q)", k, e.Integrity)
		}
		lic, ok := license(e.License)
		if !ok {
			fail("package-lock.json: %s %s: license %s is not in the allowlist of ADR-0023 (a question to the PO)", name, e.Version, lic)
		}
		pkgs = append(pkgs, Package{Name: name, Version: e.Version, License: lic, Shipped: !e.Dev})
		if !e.Dev {
			shipped = append(shipped, name)
		}
	}
	sort.Strings(shipped)
	if !slices.Equal(shipped, Shipped) {
		fail("package-lock.json: shipped (non-dev) packages %v, want exactly %v (ADR-0029 §9)", shipped, Shipped)
	}
	return pkgs, errs
}

func osFile(base string) bool {
	return base == ".DS_Store" || base == "Thumbs.db"
}

// input says whether rel (a path in the UI directory) is an input of the
// build: everything except dist/, node_modules/, the stamp and README.md.
func input(rel string) bool {
	return rel != "node_modules" && rel != "dist" && rel != StampFile && rel != "README.md" && !osFile(path.Base(rel))
}

// files returns the regular files below dir (relative, slash-separated,
// sorted) for which keep holds; a directory for which keep does not hold
// is skipped; a symbolic link or other special file is an error.
func files(dir string, keep func(string) bool) ([]string, error) {
	var out []string
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		switch {
		case rel == ".":
			return nil
		case !keep(rel):
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		case d.IsDir():
			return nil
		case d.Type().IsRegular():
			out = append(out, rel)
			return nil
		default:
			return fmt.Errorf("%s: not a regular file", rel)
		}
	})
	sort.Strings(out)
	return out, err
}

// Dist returns the files of ui/dist (relative, sorted).
func Dist(ui string) ([]string, error) {
	dir := filepath.Join(ui, "dist")
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return nil, errors.New("dist/ is missing (run ui/build.sh)")
	}
	return files(dir, func(rel string) bool { return !osFile(path.Base(rel)) })
}

func hashes(b *strings.Builder, dir, prefix string, names []string) error {
	for _, n := range names {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(n)))
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		fmt.Fprintf(b, "%s  %s%s\n", hex.EncodeToString(sum[:]), prefix, n)
	}
	return nil
}

// Stamp is the stamp of the build in ui: the sha256 of every input (every
// file of ui except dist/, node_modules/, the stamp and README.md) and of
// every file of dist/.
func Stamp(ui string) ([]byte, error) {
	inputs, err := files(ui, input)
	if err != nil {
		return nil, err
	}
	built, err := Dist(ui)
	if err != nil {
		return nil, err
	}
	var b strings.Builder
	b.WriteString("# The build stamp of the Registry Web UI (ADR-0029 §10): sha256 of every\n")
	b.WriteString("# input and of every built file. Written by ui/build.sh after\n")
	b.WriteString("# `npm ci --ignore-scripts && npm run build`, do not edit:\n")
	fmt.Fprintf(&b, "#   %s (from oec/registry)\n", Command)
	b.WriteString("# The gate recomputes it: changed inputs without a new dist/ fail.\n")
	if err := hashes(&b, ui, "", inputs); err != nil {
		return nil, err
	}
	if err := hashes(&b, filepath.Join(ui, "dist"), "dist/", built); err != nil {
		return nil, err
	}
	return []byte(b.String()), nil
}

// CheckDist checks the built files: a content type for each, no source
// map, and an index.html and style sheets that keep the CSP
// `default-src 'self'` without 'unsafe-inline': no inline script, style or
// event handler, and references to files of dist/ only; the scripts keep
// the @license comments of the shipped packages.
func CheckDist(ui string) []error {
	names, err := Dist(ui)
	if err != nil {
		return []error{err}
	}
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }
	if !slices.Contains(names, "index.html") {
		fail("dist/index.html is missing")
	}
	local := func(ref string) bool {
		p, _, _ := strings.Cut(ref, "#")
		p, _, _ = strings.Cut(p, "?")
		return strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//") && slices.Contains(names, p[1:])
	}
	licensed := false
	for _, n := range names {
		ext := path.Ext(n)
		if _, ok := Types[ext]; !ok {
			fail("dist/%s: no content type for %q", n, ext)
		}
		data, err := os.ReadFile(filepath.Join(ui, "dist", filepath.FromSlash(n)))
		if err != nil {
			fail("dist/%s: %v", n, err)
			continue
		}
		s := string(data)
		if strings.Contains(s, "sourceMappingURL") {
			fail("dist/%s: refers to a source map", n)
		}
		switch ext {
		case ".js":
			licensed = licensed || strings.Contains(s, "@license")
		case ".html":
			if inlineScript.MatchString(s) {
				fail("dist/%s: inline script (CSP)", n)
			}
			if inlineStyle.MatchString(s) {
				fail("dist/%s: inline style (CSP)", n)
			}
			if eventAttr.MatchString(s) {
				fail("dist/%s: inline event handler (CSP)", n)
			}
			for _, m := range refAttr.FindAllStringSubmatch(s, -1) {
				if !local(m[1]) {
					fail("dist/%s: %q is not a file of dist/ (CSP 'self')", n, m[1])
				}
			}
		case ".css":
			for _, m := range cssURL.FindAllStringSubmatch(s, -1) {
				if !local(m[1]) {
					fail("dist/%s: url(%s) is not a file of dist/ (CSP 'self')", n, m[1])
				}
			}
			if strings.Contains(s, "@import") {
				fail("dist/%s: @import", n)
			}
		}
	}
	if !licensed {
		fail("dist/: no script keeps the @license comments of the shipped packages (legalComments)")
	}
	return errs
}

// Table is the Rust source of the embedded files of ui/dist (TableFile):
// `UI_FILES` with path, content type and bytes, sorted by path.
func Table(ui string) ([]byte, error) {
	names, err := Dist(ui)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	b.WriteString("//! The files of the Web UI (`ui/dist/`, ADR-0029 §9) embedded in the\n")
	b.WriteString("//! binary. Generated by `ui/build.sh`, do not edit:\n")
	fmt.Fprintf(&b, "//! `%s` (from `oec/registry`).\n\n", Command)
	b.WriteString("use crate::api::UiFile;\n\n")
	b.WriteString("/// The files by path, sorted.\n")
	b.WriteString("pub(crate) const UI_FILES: &[UiFile] = &[\n")
	for _, n := range names {
		ct, ok := Types[path.Ext(n)]
		if !ok {
			return nil, fmt.Errorf("dist/%s: no content type for %q", n, path.Ext(n))
		}
		if strings.ContainsAny(n, "\"\\") {
			return nil, fmt.Errorf("dist/%s: a quote or backslash in the name", n)
		}
		fmt.Fprintf(&b, "    UiFile {\n        path: \"/%s\",\n        content_type: \"%s\",\n", n, ct)
		fmt.Fprintf(&b, "        bytes: include_bytes!(\"../ui/dist/%s\"),\n    },\n", n)
	}
	b.WriteString("];\n")
	return b.Bytes(), nil
}

// Check is the whole gate for the UI directory ui of the registry directory
// registry: CheckPackages, CheckDist, the committed stamp and the committed
// table.
func Check(ui, registry string) []error {
	_, errs := CheckPackages(ui)
	errs = append(errs, CheckDist(ui)...)
	stamp, err := Stamp(ui)
	if err != nil {
		return append(errs, err)
	}
	got, err := os.ReadFile(filepath.Join(ui, StampFile))
	switch {
	case err != nil:
		errs = append(errs, fmt.Errorf("%s: %w (run ui/build.sh)", StampFile, err))
	case !bytes.Equal(got, stamp):
		errs = append(errs, fmt.Errorf("%s is not current (run ui/build.sh): %s", StampFile, diff(string(got), string(stamp))))
	}
	table, err := Table(ui)
	if err != nil {
		return append(errs, err)
	}
	got, err = os.ReadFile(filepath.Join(registry, filepath.FromSlash(TableFile)))
	switch {
	case err != nil:
		errs = append(errs, fmt.Errorf("%s: %w (run ui/build.sh)", TableFile, err))
	case !bytes.Equal(got, table):
		errs = append(errs, fmt.Errorf("%s does not list dist/ (run ui/build.sh)", TableFile))
	}
	return errs
}

// diff names the lines that differ (at most six).
func diff(got, want string) string {
	g := strings.Split(got, "\n")
	w := strings.Split(want, "\n")
	var out []string
	for _, l := range w {
		if !slices.Contains(g, l) {
			out = append(out, "want "+l)
		}
	}
	for _, l := range g {
		if !slices.Contains(w, l) {
			out = append(out, "have "+l)
		}
	}
	if len(out) > 6 {
		out = append(out[:6], "…")
	}
	return strings.Join(out, "; ")
}

// Write writes the stamp and the table (Command).
func Write(ui, registry string) error {
	stamp, err := Stamp(ui)
	if err != nil {
		return err
	}
	table, err := Table(ui)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(ui, StampFile), stamp, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(registry, filepath.FromSlash(TableFile)), table, 0o644)
}
