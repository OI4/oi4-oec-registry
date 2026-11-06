package regtest

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// D8Test is one test of a D8 report.
type D8Test struct {
	ID      string `json:"id"`
	Outcome string `json:"outcome"`
	Reason  string `json:"reason"`
	Reqs    []struct {
		Req      string `json:"req"`
		Outcome  string `json:"outcome"`
		Evidence []struct {
			Topic  string `json:"topic"`
			Detail string `json:"detail"`
		} `json:"evidence"`
	} `json:"reqs"`
}

// D8Bus runs `oec-infra bus` (the program of OEC_D8 – run, not imported:
// D8 stays independent, ADR-0006) with the tests of the comma-separated
// list tests against the broker b and the OEC Registry il, and returns the
// tests of its JSON report and its exit code. Without a plain-text
// listener (--plain-port 0: the test broker has none).
func D8Bus(t *testing.T, b *Broker, il, tests string) ([]D8Test, int) {
	t.Helper()
	infra := Tool(t, "OEC_D8", "", "go build ./cmd/oec-infra in oec/conformance")
	password := filepath.Join(t.TempDir(), "password")
	Write(t, password, "pa:ss\n")
	cmd := exec.Command(infra, "bus",
		"--broker", fmt.Sprintf("mqtts://localhost:%d", b.Port), "--ca", b.CA,
		"--username", "user", "--password-file", password,
		"--plain-port", "0", "--max-packet-size", "262144",
		"--registry", il, "--tests", tests, "--timeout", "2s", "--format", "json")
	began := time.Now()
	out, err := cmd.Output()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
		if testing.Verbose() || code > 1 {
			t.Logf("oec-infra bus stderr:\n%s", ee.Stderr)
		}
	} else if err != nil {
		t.Fatal(err)
	}
	t.Logf("oec-infra bus --tests %s: exit %d after %v", tests, code, time.Since(began).Round(time.Second))
	var r struct {
		Tests []D8Test `json:"tests"`
	}
	if err := json.Unmarshal(out, &r); err != nil {
		t.Fatalf("oec-infra bus: %v\n%s", err, out)
	}
	if testing.Verbose() {
		t.Logf("oec-infra bus report:\n%s", out)
	}
	return r.Tests, code
}

// Registry is the path of the registry binary (OEC_REGISTRY).
func Registry(t *testing.T) string {
	t.Helper()
	return Tool(t, "OEC_REGISTRY", "registry/target/debug/oec-registry", "cargo build in oec/registry")
}

// StartRegistry starts the registry with the container storage root (and
// env) and waits for its Birth – its MAM about itself on topic – on b. The
// HTTP side is off unless env switches a port on (HTTPOff).
func StartRegistry(t *testing.T, b *Broker, root, il string, env ...string) (*Process, Seen) {
	t.Helper()
	from := b.Len()
	p := Start(t, Registry(t), append(append([]string{"OEC_ROOT=" + root}, HTTPOff...), env...)...)
	t.Cleanup(func() {
		if t.Failed() {
			t.Logf("registry stderr:\n%s", p.Stderr())
		}
	})
	s, _ := b.Publish(t, from, RegistryTopic(il, "Pub", "MAM", il))
	return p, s
}

// RegistryTopic is a topic of the registry il: Oi4v2/Registry/<il>/
// <method>/<resource>[/<source>].
func RegistryTopic(il, method, resource, source string) string {
	topic := "Oi4v2/Registry/" + Topic(il) + "/" + method + "/" + resource
	if source != "" {
		topic += "/" + Topic(source)
	}
	return topic
}

// ReadJSON reads a JSON file.
func ReadJSON(t *testing.T, path string, v any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}
