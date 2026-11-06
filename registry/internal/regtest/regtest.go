// Package regtest is the integration-test harness of the OEC Registry
// (ADR-0029 §1, §11, A-387): the in-process TLS test broker of the Rust SDK
// run as a program (go-testbroker, C-076), container storages, the
// registry as a process, and the D7 and D8 runners. Offline and without
// Docker: everything runs on loopback. It takes over the parts of the demo
// harness oec/demos/internal/demotest (C-079 … C-085) that the registry
// needs; standard library only.
//
// Tools come from the environment, with defaults below oec/:
//
//	OEC_TESTBROKER  go-testbroker (sdk/rust/target/debug/examples/go-testbroker)
//	OEC_REGISTRY    oec-registry (registry/target/debug/oec-registry)
//	OEC_D7          oec-check (no default: built by oec/registry/check.sh)
//	OEC_D8          oec-infra (no default: built by oec/registry/check.sh)
//
// A missing tool skips the test, unless OEC_REGISTRY_REQUIRE=1 (set by
// oec/registry/check.sh), then it fails.
package regtest

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// Wait is the upper bound for every wait of a test.
const Wait = 15 * time.Second

// Oec is the directory oec/ of the repository.
func Oec() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

// Tool is the path of a helper program: the environment variable env or
// def (relative to oec/, "" = none). Missing, it skips t – or fails it
// with OEC_REGISTRY_REQUIRE=1.
func Tool(t *testing.T, env, def, hint string) string {
	t.Helper()
	path := os.Getenv(env)
	if path == "" && def != "" {
		path = filepath.Join(Oec(), def)
	}
	var err error
	if path == "" {
		err = fmt.Errorf("%s is not set", env)
	} else {
		_, err = os.Stat(path)
	}
	if err != nil {
		if os.Getenv("OEC_REGISTRY_REQUIRE") == "1" {
			t.Fatalf("%s: %v (%s)", env, err, hint)
		}
		t.Skipf("%s: %v (%s)", env, err, hint)
	}
	return path
}

// Seen is one line of the test broker: what it saw on a connection.
type Seen struct {
	Seen     string   `json:"seen"`
	Conn     int      `json:"conn"`
	ClientID string   `json:"client_id"`
	Username *string  `json:"username"`
	Will     *string  `json:"will"`
	Topic    string   `json:"topic"`
	Payload  string   `json:"payload"`
	Retain   bool     `json:"retain"`
	Filters  []string `json:"filters"`
}

func (s Seen) String() string {
	switch s.Seen {
	case "publish":
		return fmt.Sprintf("%d publish %s %s", s.Conn, s.Topic, s.Payload)
	case "subscribe", "unsubscribe":
		return fmt.Sprintf("%d %s %v", s.Conn, s.Seen, s.Filters)
	default:
		return fmt.Sprintf("%d %s", s.Conn, s.Seen)
	}
}

// Broker is a running test broker (a routing broker: every publication
// goes to the matching subscribers).
type Broker struct {
	Port int    `json:"port"`
	CA   string `json:"ca"`

	stdin io.WriteCloser
	lines *lines[Seen]
}

// StartBroker starts a test broker for t; it ends with t.
func StartBroker(t *testing.T) *Broker {
	t.Helper()
	path := Tool(t, "OEC_TESTBROKER", "sdk/rust/target/debug/examples/go-testbroker",
		"cargo build -p oec-ffi --example go-testbroker")
	cmd := exec.Command(path, t.TempDir())
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 1<<20), 1<<24)
	b := &Broker{stdin: stdin}
	if !scan.Scan() {
		t.Fatalf("test broker: no first line: %v", scan.Err())
	}
	if err := json.Unmarshal(scan.Bytes(), b); err != nil {
		t.Fatalf("test broker: %v: %s", err, scan.Text())
	}
	b.lines = readLines(scan, func(line []byte) Seen {
		var s Seen
		if err := json.Unmarshal(line, &s); err != nil {
			panic(fmt.Sprintf("test broker: %v: %s", err, line))
		}
		return s
	})
	t.Cleanup(func() {
		stdin.Close()
		<-b.lines.done // Wait closes stdout
		_ = cmd.Wait()
	})
	return b
}

// Expect returns the first event from index from on that matches, with
// its index; it fails t after Wait.
func (b *Broker) Expect(t *testing.T, from int, what string, match func(Seen) bool) (Seen, int) {
	t.Helper()
	return b.lines.expect(t, from, "test broker: "+what, match)
}

// Publish waits for a PUBLISH on topic.
func (b *Broker) Publish(t *testing.T, from int, topic string) (Seen, int) {
	t.Helper()
	return b.Expect(t, from, "PUBLISH on "+topic, func(s Seen) bool {
		return s.Seen == "publish" && s.Topic == topic
	})
}

// Len is the number of events so far.
func (b *Broker) Len() int { return b.lines.len() }

// Events is a copy of the events so far.
func (b *Broker) Events() []Seen { return b.lines.all() }

// Send sends a PUBLISH to the client of connection conn.
func (b *Broker) Send(t *testing.T, conn int, topic, payload string) {
	t.Helper()
	line, _ := json.Marshal(map[string]any{"cmd": "send", "conn": conn, "topic": topic, "payload": payload})
	if _, err := b.stdin.Write(append(line, '\n')); err != nil {
		t.Fatal(err)
	}
}

// Container writes a container storage (REQ-CNT-004) for the broker below
// a new temporary directory: the hostname (the MQTT client id and the
// SerialNumber), broker.json, the CA and the credentials user/pa:ss.
func (b *Broker) Container(t *testing.T, hostname string) string {
	t.Helper()
	root := t.TempDir()
	ca, err := os.ReadFile(b.CA)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"etc/hostname":                hostname + "\n",
		"etc/oi4/mqtt/broker.json":    fmt.Sprintf(`{"Address": "localhost", "SecurePort": %d, "MaxPacketSize": 262144}`, b.Port),
		"etc/oi4/certs/ca.pem":        string(ca),
		"run/secrets/oi4/credentials": "dXNlcjpwYTpzcw==\n", // base64("user:pa:ss")
	} {
		Write(t, filepath.Join(root, name), content)
	}
	if err := os.MkdirAll(filepath.Join(root, "etc", "oi4", "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

// Write writes a file and its directories.
func Write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Eventually polls cond until it holds; it fails t after Wait.
func Eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(Wait)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("not within %v: %s", Wait, what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// lines collects the lines of a program's output for waiting.
type lines[T any] struct {
	mu    sync.Mutex
	cond  *sync.Cond
	items []T
	ended bool
	done  chan struct{}
}

func readLines[T any](scan *bufio.Scanner, parse func([]byte) T) *lines[T] {
	l := &lines[T]{done: make(chan struct{})}
	l.cond = sync.NewCond(&l.mu)
	go func() {
		defer close(l.done)
		for scan.Scan() {
			item := parse(scan.Bytes())
			l.mu.Lock()
			l.items = append(l.items, item)
			l.cond.Broadcast()
			l.mu.Unlock()
		}
		l.mu.Lock()
		l.ended = true
		l.cond.Broadcast()
		l.mu.Unlock()
	}()
	return l
}

func (l *lines[T]) expect(t *testing.T, from int, what string, match func(T) bool) (T, int) {
	t.Helper()
	deadline := time.Now().Add(Wait)
	timer := time.AfterFunc(Wait, func() {
		l.mu.Lock()
		l.cond.Broadcast()
		l.mu.Unlock()
	})
	defer timer.Stop()
	l.mu.Lock()
	defer l.mu.Unlock()
	for i := from; ; {
		for ; i < len(l.items); i++ {
			if match(l.items[i]) {
				return l.items[i], i
			}
		}
		if l.ended || time.Now().After(deadline) {
			var all []string
			for _, e := range l.items {
				all = append(all, fmt.Sprint(e))
			}
			t.Fatalf("no %s within %v; seen:\n%s", what, Wait, strings.Join(all, "\n"))
		}
		l.cond.Wait()
	}
}

func (l *lines[T]) len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.items)
}

func (l *lines[T]) all() []T {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]T(nil), l.items...)
}

// Topic is the topic level of an Identification Link (base64url without
// padding, REQ-TOP-019).
func Topic(il string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(il))
}

// AsJSON decodes a payload.
func AsJSON(t *testing.T, payload string) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal([]byte(payload), &v); err != nil {
		t.Fatalf("%v: %s", err, payload)
	}
	return v
}
