package uipolicy

import (
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const (
	realUI       = "../../ui"
	realRegistry = "../.."
)

// The committed UI keeps the npm policy, its dist/ the CSP rules, and the
// committed stamp and table are current (ADR-0029 §10: the gate without
// node and network).
func TestUI(t *testing.T) {
	for _, err := range Check(realUI, realRegistry) {
		t.Error(err)
	}
	pkgs, _ := CheckPackages(realUI)
	var shipped []string
	licenses := map[string]int{}
	for _, p := range pkgs {
		licenses[p.License]++
		if p.Shipped {
			shipped = append(shipped, p.Name+"@"+p.Version)
		}
	}
	if want := []string{"react@19.3.1", "react-dom@19.3.1", "scheduler@0.28.0"}; !slices.Equal(shipped, want) {
		t.Errorf("shipped %v, want %v", shipped, want)
	}
	t.Logf("%d packages in the lockfile, licenses %v", len(pkgs), licenses)
}

// copyUI copies the UI (without node_modules) and the table into a
// temporary registry directory and returns its ui and registry paths.
func copyUI(t *testing.T) (string, string) {
	t.Helper()
	reg := t.TempDir()
	ui := filepath.Join(reg, "ui")
	err := filepath.WalkDir(realUI, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(realUI, p)
		if rel == "node_modules" {
			return filepath.SkipDir
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(ui, rel), 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(ui, rel), data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	table, err := os.ReadFile(filepath.Join(realRegistry, TableFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(reg, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(reg, TableFile), table, 0o644); err != nil {
		t.Fatal(err)
	}
	return ui, reg
}

func write(t *testing.T, file, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

// editJSON changes a JSON file of ui through f.
func editJSON(t *testing.T, file string, f func(map[string]any)) {
	t.Helper()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	f(v)
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	write(t, file, string(out))
}

func pkg(v map[string]any, key string) map[string]any {
	return v["packages"].(map[string]any)[key].(map[string]any)
}

func expect(t *testing.T, errs []error, want string) {
	t.Helper()
	for _, err := range errs {
		if strings.Contains(err.Error(), want) {
			return
		}
	}
	t.Errorf("no error with %q in %v", want, errs)
}

// Every rule of the npm policy, the stamp, the CSP rules and the table
// fails on a violation.
func TestViolations(t *testing.T) {
	type edit func(t *testing.T, ui, reg string)
	lock := func(f func(map[string]any)) edit {
		return func(t *testing.T, ui, _ string) { editJSON(t, filepath.Join(ui, "package-lock.json"), f) }
	}
	manifest := func(f func(map[string]any)) edit {
		return func(t *testing.T, ui, _ string) { editJSON(t, filepath.Join(ui, "package.json"), f) }
	}
	cases := []struct {
		name string
		edit edit
		want string
	}{
		{"caret", manifest(func(v map[string]any) { v["devDependencies"].(map[string]any)["vite"] = "^7.3.7" }), `vite "^7.3.7" is not an exact version`},
		{"extra-dependency", manifest(func(v map[string]any) { v["dependencies"].(map[string]any)["lodash"] = "4.17.21" }), "dependencies [lodash react react-dom]"},
		{"install-script", manifest(func(v map[string]any) { v["scripts"].(map[string]any)["postinstall"] = "node x.js" }), "no install scripts"},
		{"overrides", manifest(func(v map[string]any) { v["overrides"] = map[string]any{"rollup": "4.0.0"} }), "overrides is not allowed"},
		{"public", manifest(func(v map[string]any) { delete(v, "private") }), "not private"},
		{"lockfile-v2", lock(func(v map[string]any) { v["lockfileVersion"] = 2 }), "lockfileVersion 2, want 3"},
		{"root-differs", lock(func(v map[string]any) {
			pkg(v, "")["dependencies"].(map[string]any)["react"] = "19.3.0"
		}), "root entry differs"},
		{"not-locked", lock(func(v map[string]any) { pkg(v, "node_modules/react")["version"] = "19.3.0" }), "react is not locked at 19.3.1"},
		{"other-registry", lock(func(v map[string]any) {
			pkg(v, "node_modules/picomatch")["resolved"] = "https://registry.example/picomatch/-/picomatch-4.0.7.tgz"
		}), "node_modules/picomatch is resolved from"},
		{"git-dependency", lock(func(v map[string]any) {
			pkg(v, "node_modules/nanoid")["resolved"] = "git+ssh://git@github.com/ai/nanoid.git#abc"
		}), "node_modules/nanoid is resolved from"},
		{"no-integrity", lock(func(v map[string]any) { delete(pkg(v, "node_modules/fdir"), "integrity") }), "node_modules/fdir has no sha512 integrity"},
		{"sha1", lock(func(v map[string]any) {
			pkg(v, "node_modules/fdir")["integrity"] = "sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk="
		}), "node_modules/fdir has no sha512 integrity"},
		{"mpl", lock(func(v map[string]any) { pkg(v, "node_modules/postcss")["license"] = "MPL-2.0" }), "license MPL-2.0 is not in the allowlist"},
		{"gpl-or", lock(func(v map[string]any) { pkg(v, "node_modules/postcss")["license"] = "(MIT OR GPL-3.0-only)" }), "license (MIT OR GPL-3.0-only) is not in the allowlist"},
		{"no-license", lock(func(v map[string]any) { delete(pkg(v, "node_modules/postcss"), "license") }), "postcss 8.5.31: license"},
		{"shipped-tool", lock(func(v map[string]any) { delete(pkg(v, "node_modules/rollup"), "dev") }), "shipped (non-dev) packages [react react-dom rollup scheduler]"},
		{"link", lock(func(v map[string]any) {
			v["packages"].(map[string]any)["node_modules/local"] = map[string]any{"resolved": "../local", "link": true}
		}), "node_modules/local is a link"},
		{"outside", lock(func(v map[string]any) {
			v["packages"].(map[string]any)["../local"] = map[string]any{"version": "1.0.0"}
		}), "../local is not a package of node_modules"},
		{"changed-source", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "src", "App.tsx"), "export function App() { return null; }\n")
		}, "build.stamp is not current"},
		{"new-source", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "src", "New.tsx"), "export {};\n")
		}, "want "},
		{"changed-dist", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "favicon.svg"), "<svg/>")
		}, "build.stamp is not current"},
		{"no-stamp", func(t *testing.T, ui, _ string) { os.Remove(filepath.Join(ui, StampFile)) }, "build.stamp: "},
		{"no-dist", func(t *testing.T, ui, _ string) { os.RemoveAll(filepath.Join(ui, "dist")) }, "dist/ is missing"},
		{"inline-script", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "index.html"), `<html><script>alert(1)</script></html>`)
		}, "inline script"},
		{"inline-style", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "index.html"), `<html><div style="color:red"></div></html>`)
		}, "inline style"},
		{"handler", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "index.html"), `<html><body onload="x()"></body></html>`)
		}, "inline event handler"},
		{"external-script", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "index.html"), `<html><script src="https://cdn.example/x.js"></script></html>`)
		}, `"https://cdn.example/x.js" is not a file of dist/`},
		{"css-data-url", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "assets", "x.css"), `a{background:url(data:image/png;base64,AA==)}`)
		}, "url(data:image/png;base64,AA==) is not a file of dist/"},
		{"source-map", func(t *testing.T, ui, _ string) {
			write(t, filepath.Join(ui, "dist", "assets", "x.js.map"), `{}`)
		}, `no content type for ".map"`},
		{"no-license-comments", func(t *testing.T, ui, _ string) {
			names, _ := Dist(ui)
			for _, n := range names {
				if path.Ext(n) == ".js" {
					write(t, filepath.Join(ui, "dist", n), "console.log(1);\n")
				}
			}
		}, "no script keeps the @license comments"},
		{"table", func(t *testing.T, _, reg string) {
			write(t, filepath.Join(reg, TableFile), "// stale\n")
		}, "src/ui_assets.rs does not list dist/"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ui, reg := copyUI(t)
			if errs := Check(ui, reg); len(errs) != 0 {
				t.Fatalf("the copy fails already: %v", errs)
			}
			c.edit(t, ui, reg)
			expect(t, Check(ui, reg), c.want)
		})
	}
}

// Write makes a rebuilt dist/ current again.
func TestWrite(t *testing.T) {
	ui, reg := copyUI(t)
	write(t, filepath.Join(ui, "dist", "assets", "extra.css"), "a{color:red}\n")
	if errs := Check(ui, reg); len(errs) == 0 {
		t.Fatal("a new file of dist/ passes")
	}
	if err := Write(ui, reg); err != nil {
		t.Fatal(err)
	}
	if errs := Check(ui, reg); len(errs) != 0 {
		t.Fatal(errs)
	}
	table, _ := os.ReadFile(filepath.Join(reg, TableFile))
	if !strings.Contains(string(table), `include_bytes!("../ui/dist/assets/extra.css")`) {
		t.Errorf("table without the new file:\n%s", table)
	}
}
