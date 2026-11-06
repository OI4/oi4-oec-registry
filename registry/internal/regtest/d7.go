package regtest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// D7 describes a run of `oec-check test` against the registry.
type D7 struct {
	Exe      string   // the registry; started with OEC_ROOT and Env
	Env      []string // extra environment of the registry
	Hostname string   // of the container storage
	App      string   // ServiceType/AppId of the registry (--app)
	Level    int      // --level
	Pass     []string // the tests that must pass
	Report   string   // environment variable: keep the JSON report there
}

// RunD7 runs D7 (`oec-check test`, the program of OEC_D7 – run, not
// imported: D7 stays independent, ADR-0006) against the registry on a test
// broker, with the proxy attachment, the restart hook, the peer and D7
// announced (pattern oec/sdk/go/d7_test.go, C-076). It fails on every
// fail, on a test of Pass that does not pass and on exit ≠ 0. It returns
// the broker, for a look at the wire.
func RunD7(t *testing.T, d D7) *Broker {
	t.Helper()
	check := Tool(t, "OEC_D7", "", "go build ./cmd/oec-check in oec/conformance")
	b := StartBroker(t)
	work := t.TempDir()
	proxyCA, proxyKey := ProxyCA(t, work)
	proxyPort := FreePort(t)

	root := b.Container(t, d.Hostname)
	Write(t, filepath.Join(root, "etc", "oi4", "mqtt", "broker.json"),
		fmt.Sprintf(`{"Address": "localhost", "SecurePort": %d, "MaxPacketSize": 262144}`, proxyPort))
	ca, err := os.ReadFile(proxyCA)
	if err != nil {
		t.Fatal(err)
	}
	Write(t, filepath.Join(root, "etc", "oi4", "certs", "ca.pem"), string(ca))
	password := filepath.Join(work, "password")
	Write(t, password, "pa:ss\n")

	// The restart hook: SIGTERM and wait; start again in the background.
	pid := filepath.Join(work, "registry.pid")
	logf := filepath.Join(work, "registry.log")
	start := filepath.Join(work, "start.sh")
	stop := filepath.Join(work, "stop.sh")
	env := fmt.Sprintf("OEC_ROOT=%q", root)
	for _, e := range d.Env {
		k, v, _ := strings.Cut(e, "=")
		env += fmt.Sprintf(" %s=%q", k, v)
	}
	Write(t, start, fmt.Sprintf("#!/bin/sh\n%s %q >> %q 2>&1 &\necho $! > %q\n", env, d.Exe, logf, pid))
	Write(t, stop, fmt.Sprintf("#!/bin/sh\nP=$(cat %q)\nkill -TERM \"$P\"\nwhile kill -0 \"$P\" 2>/dev/null; do sleep 0.1; done\n", pid))
	for _, f := range []string{start, stop} {
		if err := os.Chmod(f, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if out, err := exec.Command(start).CombinedOutput(); err != nil {
		t.Fatalf("start.sh: %v %s", err, out)
	}
	t.Cleanup(func() {
		if s, err := os.ReadFile(pid); err == nil {
			if p, err := strconv.Atoi(strings.TrimSpace(string(s))); err == nil {
				_ = syscall.Kill(p, syscall.SIGKILL)
			}
		}
		if log, err := os.ReadFile(logf); err == nil && (t.Failed() || testing.Verbose()) {
			t.Logf("%s (stdout and stderr of the registry, last 64 KiB):\n%s", filepath.Base(logf), tail(log, 64<<10))
		}
	})

	report := filepath.Join(work, "d7.json")
	cmd := exec.Command(check, "test",
		"--broker", fmt.Sprintf("mqtts://localhost:%d", b.Port), "--ca", b.CA,
		"--username", "user", "--password-file", password,
		"--app", d.App, "--level", strconv.Itoa(d.Level),
		"--timeout", "3s",
		"--proxy-listen", fmt.Sprintf("127.0.0.1:%d", proxyPort),
		"--proxy-ca", proxyCA, "--proxy-ca-key", proxyKey,
		"--stop-cmd", stop, "--start-cmd", start, "--restart-wait", "15s", "--peer", "--announce",
		"--format", "text", "--report", "json="+report)
	began := time.Now()
	out, err := cmd.CombinedOutput()
	t.Logf("oec-check test --level %d: %v after %v", d.Level, err, time.Since(began).Round(time.Second))
	if err != nil {
		t.Fatalf("oec-check test: %v\n%s", err, out)
	}
	raw, err := os.ReadFile(report)
	if err != nil {
		t.Fatal(err)
	}
	if d.Report != "" {
		if keep := os.Getenv(d.Report); keep != "" {
			if err := os.WriteFile(keep, raw, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	var r struct {
		Exit  int `json:"exit"`
		Tests []struct {
			ID      string `json:"id"`
			Outcome string `json:"outcome"`
		} `json:"tests"`
		Summary map[string]int `json:"summary"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	t.Logf("summary %v, exit %d", r.Summary, r.Exit)
	if testing.Verbose() {
		t.Logf("oec-check output:\n%s", out)
	}
	outcome := map[string]string{}
	for _, x := range r.Tests {
		outcome[x.ID] = x.Outcome
		if x.Outcome == "fail" {
			t.Errorf("%s: fail", x.ID)
		}
	}
	for _, id := range d.Pass {
		if outcome[id] != "pass" {
			t.Errorf("%s: %q, want pass", id, outcome[id])
		}
	}
	if r.Exit != 0 || t.Failed() {
		t.Errorf("exit %d\n%s", r.Exit, out)
	}
	return b
}

func tail(b []byte, n int) []byte {
	if len(b) > n {
		return b[len(b)-n:]
	}
	return b
}

// ProxyCA writes a CA for the proxy attachment of D7 (test material only,
// generated per test, never committed).
func ProxyCA(t *testing.T, dir string) (string, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "OEC registry test proxy CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	cert, k := filepath.Join(dir, "proxy-ca.pem"), filepath.Join(dir, "proxy-ca.key")
	Write(t, cert, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})))
	Write(t, k, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})))
	return cert, k
}

// FreePort is a free loopback port (closed again, so another process could
// take it first – unlikely in a test).
func FreePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}
