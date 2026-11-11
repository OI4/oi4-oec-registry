package regtest

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// The limits of the HTTP side of the registry (ADR-0029 §7, ADR-0028
// amendment C-083, src/http.rs).
const (
	HTTPMaxConnections = 16
	HTTPMaxStreams     = 8
	HTTPMaxBody        = 64 << 10
	HTTPMaxHead        = 8 << 10
	// HTTPRequestTime is the time a client has for the TLS handshake and
	// again for its request head.
	HTTPRequestTime = 5 * time.Second
	// HTTPMaxJSON is the largest body of the user management (ADR-0035).
	HTTPMaxJSON = 4 << 10
	// AdminPassword is the password of the first user admin of the
	// containers of Container (run/secrets/oi4/registry_admin_password).
	AdminPassword = "registry test admin"
)

// HTTPOff is the environment that switches the HTTP side off (the tests
// of the bus side; the default ports 5798/5799 stay free).
var HTTPOff = []string{"OEC_REGISTRY_WEB=", "OEC_REGISTRY_API="}

// Web is a port of the HTTP side of the registry on Addr (host:port).
type Web struct {
	Addr string
	// TLS is the client configuration (nil: plain HTTP).
	TLS *tls.Config
	// Token is the session of the requests (Authorization: Bearer; "":
	// none), see Login.
	Token string
}

// LoopbackAddr is a free loopback address for OEC_REGISTRY_WEB/API.
func LoopbackAddr(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("127.0.0.1:%d", FreePort(t))
}

// WaitWeb waits until addr accepts connections.
func WaitWeb(t *testing.T, addr string, conf *tls.Config) *Web {
	t.Helper()
	Eventually(t, "HTTP on "+addr, func() bool {
		c, err := net.Dial("tcp", addr)
		if err == nil {
			c.Close()
		}
		return err == nil
	})
	return &Web{Addr: addr, TLS: conf}
}

// As is a copy of w with the session of another login.
func (w *Web) As(t *testing.T, name, password string) *Web {
	t.Helper()
	c := &Web{Addr: w.Addr, TLS: w.TLS}
	c.Login(t, name, password)
	return c
}

// Login logs in (POST /api/login, expects 200) and keeps the token; the
// answer (name, role, mustChange, token).
func (w *Web) Login(t *testing.T, name, password string) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name, "password": password})
	resp, raw := w.Do(t, "POST", "/api/login", "application/json", string(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s: %d %s", name, resp.StatusCode, raw)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("login %s: %v in %s", name, err, raw)
	}
	w.Token, _ = out["token"].(string)
	return out
}

// auth is the header line of the session ("" without one).
func (w *Web) auth() string {
	if w.Token == "" {
		return ""
	}
	return "Authorization: Bearer " + w.Token + "\r\n"
}

// Scheme is https or http.
func (w *Web) Scheme() string {
	if w.TLS != nil {
		return "https"
	}
	return "http"
}

// Client is a client without connection reuse (the server closes every
// connection after its response).
func (w *Web) Client() *http.Client {
	return &http.Client{Timeout: Wait, Transport: &http.Transport{TLSClientConfig: w.TLS, DisableKeepAlives: true}}
}

// Dial opens a connection, with the TLS handshake if TLS.
func (w *Web) Dial(t *testing.T) net.Conn {
	t.Helper()
	c, err := net.Dial("tcp", w.Addr)
	if err != nil {
		t.Fatal(err)
	}
	_ = c.SetDeadline(time.Now().Add(Wait))
	if w.TLS == nil {
		return c
	}
	tc := tls.Client(c, w.TLS)
	if err := tc.Handshake(); err != nil {
		c.Close()
		t.Fatalf("TLS handshake with %s: %v", w.Addr, err)
	}
	return tc
}

// Do sends a request (body "" = none) and returns the response with its
// body read.
func (w *Web) Do(t *testing.T, method, path, contentType, body string) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, w.Scheme()+"://"+w.Addr+path, r)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if w.Token != "" {
		req.Header.Set("Authorization", "Bearer "+w.Token)
	}
	resp, err := w.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp, raw
}

// JSON gets path, expects 200 with a JSON body and the common headers,
// and decodes it into out.
func (w *Web) JSON(t *testing.T, path string, out any) {
	t.Helper()
	resp, raw := w.Do(t, "GET", path, "", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, resp.StatusCode, raw)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("GET %s: Content-Type %q", path, ct)
	}
	CheckHeaders(t, "GET "+path, resp)
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("GET %s: %v in %s", path, err, raw)
	}
}

// Raw sends request as text on a new connection and returns the status
// line of the answer ("" if the connection ends without one).
func (w *Web) Raw(t *testing.T, request string) string {
	t.Helper()
	c := w.Dial(t)
	defer c.Close()
	// A server may answer before it has read the whole request (431) and
	// close; the write then fails with a reset, but the answer is there.
	_, werr := io.WriteString(c, request)
	line, rerr := bufio.NewReader(c).ReadString('\n')
	if werr != nil && !strings.HasPrefix(line, "HTTP/") {
		t.Fatalf("write: %v; read: %q, %v", werr, line, rerr)
	}
	return strings.TrimSpace(line)
}

// CheckHeaders checks the headers of every response.
func CheckHeaders(t *testing.T, what string, resp *http.Response) {
	t.Helper()
	for k, v := range map[string]string{
		"Cache-Control":           "no-store",
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
		"Referrer-Policy":         "no-referrer",
	} {
		if got := resp.Header.Get(k); got != v {
			t.Errorf("%s: %s %q, want %q", what, k, got, v)
		}
	}
	if !resp.Close {
		t.Errorf("%s: no Connection: close", what)
	}
}

// SSEItem is one line of an event stream that is not empty: an event with
// its data (Type is its member "type") or a comment.
type SSEItem struct {
	Comment string
	Type    string
	Data    map[string]any
	Raw     string
}

func (i SSEItem) String() string { return i.Raw }

// SSE is an open event stream GET /api/stream.
type SSE struct {
	resp  *http.Response
	items *lines[SSEItem]
	once  sync.Once
}

// Stream opens the event stream; it is closed at the end of t.
func (w *Web) Stream(t *testing.T) *SSE {
	t.Helper()
	s, status := w.TryStream(t)
	if s == nil {
		t.Fatalf("GET /api/stream: %s", status)
	}
	return s
}

// TryStream opens the event stream; nil and the status if refused.
func (w *Web) TryStream(t *testing.T) (*SSE, string) {
	t.Helper()
	req, err := http.NewRequest("GET", w.Scheme()+"://"+w.Addr+"/api/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	if w.Token != "" {
		req.Header.Set("Authorization", "Bearer "+w.Token)
	}
	client := w.Client()
	client.Timeout = 0
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /api/stream: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return nil, resp.Status
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("event stream: Content-Type %q", ct)
	}
	CheckHeaders(t, "GET /api/stream", resp)
	s := &SSE{resp: resp}
	scan := bufio.NewScanner(resp.Body)
	scan.Buffer(make([]byte, 1<<20), 1<<24)
	s.items = readLines(scan, func(b []byte) SSEItem {
		line := string(b)
		item := SSEItem{Raw: line}
		switch {
		case strings.HasPrefix(line, ":"):
			item.Comment = strings.TrimSpace(line[1:])
		case strings.HasPrefix(line, "data: "):
			if err := json.Unmarshal(b[len("data: "):], &item.Data); err != nil {
				item.Type = "invalid JSON: " + err.Error()
			} else {
				item.Type, _ = item.Data["type"].(string)
			}
		case line != "":
			item.Type = "invalid line"
		}
		return item
	})
	t.Cleanup(s.Close)
	return s, resp.Status
}

// Close ends the stream.
func (s *SSE) Close() {
	s.once.Do(func() {
		s.resp.Body.Close()
		<-s.items.done
	})
}

// All is a copy of the lines so far.
func (s *SSE) All() []SSEItem { return s.items.all() }

// Ended is closed when the server has ended the stream.
func (s *SSE) Ended() <-chan struct{} { return s.items.done }

// Expect waits for a line from index from on that matches.
func (s *SSE) Expect(t *testing.T, from int, what string, match func(SSEItem) bool) (SSEItem, int) {
	t.Helper()
	return s.items.expect(t, from, "event: "+what, match)
}

// Event waits for an event of the type from index from on that matches
// (nil: any).
func (s *SSE) Event(t *testing.T, from int, typ string, match func(map[string]any) bool) (map[string]any, int) {
	t.Helper()
	item, i := s.Expect(t, from, typ, func(i SSEItem) bool {
		return i.Type == typ && (match == nil || match(i.Data))
	})
	return item.Data, i
}

// CheckGuards checks the request guards (ADR-0028 amendment C-083, the
// registry variant: the directory is read-only, so every method but GET
// is 405 with Allow: GET – also a POST with a body of another type) and
// that the resource needs a session (401, ADR-0035). path is a JSON
// resource of the directory (GET); w has a session.
func (w *Web) CheckGuards(t *testing.T, path string) {
	t.Helper()
	a := w.auth()
	h := "Host: " + w.Addr + "\r\n" + a
	big := strings.Repeat("a", 2*HTTPMaxHead+4096)
	origin := w.Scheme() + "://" + w.Addr
	other := "https://"
	if w.TLS != nil {
		other = "http://"
	}
	for request, want := range map[string]string{
		"GET " + path + " HTTP/1.1\r\n" + h + "\r\n":                                                                              "200",
		"GET " + path + " HTTP/1.1\r\nHost: localhost\r\n" + a + "\r\n":                                                           "200",
		"GET " + path + " HTTP/1.1\r\nHost: reg-1\r\n" + a + "\r\n":                                                               "200",
		"GET " + path + " HTTP/1.1\r\nHost: localhost\r\n\r\n":                                                                    "401",
		"GET " + path + " HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer " + strings.Repeat("0", 64) + "\r\n\r\n":           "401",
		"GET " + path + " HTTP/1.1\r\nHost: registry.example\r\n\r\n":                                                             "403",
		"GET " + path + " HTTP/1.1\r\nHost: localhost.example:80\r\n\r\n":                                                         "403",
		"GET " + path + " HTTP/1.1\r\n\r\n":                                                                                       "400",
		"GET " + path + " HTTP/1.1\r\n" + h + h + "\r\n":                                                                          "400",
		"GET " + w.Scheme() + "://registry.example" + path + " HTTP/1.1\r\n" + h + "\r\n":                                         "400",
		"GET " + path + " HTTP/1.1\r\n" + h + "Origin: " + w.Scheme() + "://registry.example\r\n\r\n":                             "403",
		"GET " + path + " HTTP/1.1\r\n" + h + "Origin: " + other + w.Addr + "\r\n\r\n":                                            "403",
		"GET " + path + " HTTP/1.1\r\n" + h + "Origin: " + origin + "\r\n\r\n":                                                    "200",
		"POST " + path + " HTTP/1.1\r\n" + h + "Transfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n0\r\n\r\n":    "501",
		"POST " + path + " HTTP/1.1\r\n" + h + "Content-Type: text/plain\r\nContent-Length: 2\r\n\r\n{}":                          "405",
		"POST " + path + " HTTP/1.1\r\n" + h + "Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}":                    "405",
		fmt.Sprintf("POST %s HTTP/1.1\r\n%sContent-Type: application/json\r\nContent-Length: %d\r\n\r\n", path, h, HTTPMaxBody+1): "413",
		"GET " + path + " HTTP/1.1\r\n" + h + "X-Big: " + big + "\r\n\r\n":                                                        "431",
		"GET /nope HTTP/1.1\r\n" + h + "\r\n":                                                                                     "404",
		"GET /api/login HTTP/1.1\r\n" + h + "\r\n":                                                                                "405",
		"GET /api/assets/%zz HTTP/1.1\r\n" + h + "\r\n":                                                                           "404",
		"PUT " + path + " HTTP/1.1\r\n" + h + "Content-Length: 0\r\n\r\n":                                                         "405",
		"PATCH " + path + " HTTP/1.1\r\n" + h + "Content-Length: 0\r\n\r\n":                                                       "405",
		"DELETE " + path + " HTTP/1.1\r\n" + h + "\r\n":                                                                           "405",
		"OPTIONS " + path + " HTTP/1.1\r\n" + h + "\r\n":                                                                          "405",
		"HEAD " + path + " HTTP/1.1\r\n" + h + "\r\n":                                                                             "405",
	} {
		got := w.Raw(t, request)
		if f := strings.Fields(got); len(f) < 2 || f[0] != "HTTP/1.1" || f[1] != want {
			if w.Token != "" {
				request = strings.ReplaceAll(request, w.Token, "<token>")
			}
			if len(request) > 120 {
				request = request[:120] + "…"
			}
			t.Errorf("%q: %q, want %s", request, got, want)
		}
	}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		resp, raw := w.Do(t, method, path, "application/json", "{}")
		if resp.StatusCode != http.StatusMethodNotAllowed || resp.Header.Get("Allow") != "GET" {
			t.Errorf("%s %s: %d, Allow %q", method, path, resp.StatusCode, resp.Header.Get("Allow"))
		}
		CheckHeaders(t, method+" "+path, resp)
		var e map[string]any
		if err := json.Unmarshal(raw, &e); err != nil || e["error"] == nil {
			t.Errorf("%s %s: no error object: %s", method, path, raw)
		}
	}
}

// CheckLimits checks the limits of the event streams (at most
// HTTPMaxStreams, 503 beyond, a place frees when a client goes) and of the
// connections (at most HTTPMaxConnections, 503 beyond). Streams of earlier
// checks may still hold a place until the server notices their end: every
// step retries.
func (w *Web) CheckLimits(t *testing.T) {
	t.Helper()
	var streams []*SSE
	Eventually(t, fmt.Sprintf("%d event streams", HTTPMaxStreams), func() bool {
		for len(streams) < HTTPMaxStreams {
			s, _ := w.TryStream(t)
			if s == nil {
				time.Sleep(50 * time.Millisecond)
				return false
			}
			s.Event(t, 0, "snapshot", nil)
			streams = append(streams, s)
		}
		return true
	})
	if s, status := w.TryStream(t); s != nil || !strings.HasPrefix(status, "503") {
		t.Errorf("event stream %d: %s", HTTPMaxStreams+1, status)
	}
	streams[0].Close()
	streams = streams[1:]
	Eventually(t, "a free event stream after a close", func() bool {
		s, _ := w.TryStream(t)
		if s != nil {
			streams = append(streams, s)
		}
		return s != nil
	})
	for _, s := range streams {
		s.Close()
	}

	// Connections up to the limit are served, one more is refused with 503:
	// HTTPMaxConnections are opened and held, one more gets 503, then every
	// held one gets its answer 200. Streams closed above may still hold a
	// place until the server notices: retry.
	Eventually(t, fmt.Sprintf("%d connections served, one more refused", HTTPMaxConnections), func() bool {
		var conns []net.Conn
		defer func() {
			for _, c := range conns {
				c.Close()
			}
		}()
		for i := 0; i < HTTPMaxConnections; i++ {
			c, err := net.Dial("tcp", w.Addr)
			if err != nil {
				t.Fatal(err)
			}
			_ = c.SetDeadline(time.Now().Add(Wait))
			conns = append(conns, c)
		}
		time.Sleep(300 * time.Millisecond)
		if got := w.Raw(t, "GET /api/events HTTP/1.1\r\nHost: "+w.Addr+"\r\n"+w.auth()+"\r\n"); !strings.HasPrefix(got, "HTTP/1.1 503") {
			t.Errorf("connection %d: %q", HTTPMaxConnections+1, got)
		}
		for i, c := range conns {
			if w.TLS != nil {
				tc := tls.Client(c, w.TLS)
				if err := tc.Handshake(); err != nil {
					t.Fatalf("connection %d: %v", i+1, err)
				}
				c = tc
			}
			if _, err := io.WriteString(c, "GET /api/events HTTP/1.1\r\nHost: "+w.Addr+"\r\n"+w.auth()+"\r\n"); err != nil {
				t.Fatal(err)
			}
			line, _ := bufio.NewReader(c).ReadString('\n')
			if strings.HasPrefix(line, "HTTP/1.1 503") {
				return false
			}
			if !strings.HasPrefix(line, "HTTP/1.1 200") {
				t.Fatalf("connection %d: %q", i+1, line)
			}
		}
		return true
	})
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// CheckSlow checks the time limits (HTTPRequestTime): a client that does
// not start the TLS handshake, and one that does not finish its head, is
// disconnected (or answered with 408) – not earlier than half of the limit
// and not much later than the limit.
func (w *Web) CheckSlow(t *testing.T) {
	t.Helper()
	var wg sync.WaitGroup
	check := func(what string, c net.Conn, start time.Time) {
		defer wg.Done()
		defer c.Close()
		_ = c.SetReadDeadline(start.Add(HTTPRequestTime + 3*time.Second))
		got, err := io.ReadAll(c)
		took := time.Since(start)
		if isTimeout(err) {
			t.Errorf("%s: still open after %v", what, took)
			return
		}
		if len(got) > 0 && !strings.HasPrefix(string(got), "HTTP/1.1 408") {
			t.Errorf("%s: %q", what, got)
		}
		if took < HTTPRequestTime/2 {
			t.Errorf("%s: ended after %v, limit %v", what, took, HTTPRequestTime)
		}
		first, _, _ := strings.Cut(string(got), "\r\n")
		t.Logf("%s: ended after %v (%q)", what, took.Round(10*time.Millisecond), first)
	}
	if w.TLS != nil {
		raw, err := net.Dial("tcp", w.Addr)
		if err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go check("no TLS handshake", raw, time.Now())
	}
	c := w.Dial(t)
	start := time.Now()
	if _, err := c.Write([]byte("GET /api/events HTTP/1.1\r\nHost: " + w.Addr + "\r\n")); err != nil {
		t.Fatal(err)
	}
	wg.Add(1)
	go check("slow request head", c, start)
	wg.Wait()
}

// CheckKeepAlive checks that a quiet event stream gets the comment
// keep-alive (the registry runs with OEC_REGISTRY_KEEPALIVE_MS short) and
// that every line is valid.
func (w *Web) CheckKeepAlive(t *testing.T) {
	t.Helper()
	s := w.Stream(t)
	defer s.Close()
	s.Expect(t, 0, "keep-alive comment", func(i SSEItem) bool { return i.Comment == "keep-alive" })
	for _, i := range s.All() {
		if strings.HasPrefix(i.Type, "invalid") {
			t.Errorf("event stream: %s: %q", i.Type, i.Raw)
		}
	}
}

// OpenAPI is the document api/openapi.json.
type OpenAPI struct {
	doc map[string]any
}

// LoadOpenAPI reads api/openapi.json (the working directory is the module
// root).
func LoadOpenAPI(t *testing.T) *OpenAPI {
	t.Helper()
	var doc map[string]any
	ReadJSON(t, "api/openapi.json", &doc)
	return &OpenAPI{doc: doc}
}

// Paths are the paths of the document.
// Methods are the methods of path (upper case, sorted).
func (o *OpenAPI) Methods(path string) []string {
	var out []string
	for k := range o.doc["paths"].(map[string]any)[path].(map[string]any) {
		if k != "parameters" {
			out = append(out, strings.ToUpper(k))
		}
	}
	sort.Strings(out)
	return out
}

func (o *OpenAPI) Paths() []string {
	var out []string
	for p := range o.doc["paths"].(map[string]any) {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// members are the properties and required members of a component schema
// with those of its allOf.
func (o *OpenAPI) members(name string) (map[string]bool, []string) {
	s := o.doc["components"].(map[string]any)["schemas"].(map[string]any)[name].(map[string]any)
	props := map[string]bool{}
	var required []string
	ps, _ := s["properties"].(map[string]any)
	for p := range ps {
		props[p] = true
	}
	rs, _ := s["required"].([]any)
	for _, r := range rs {
		required = append(required, r.(string))
	}
	if all, ok := s["allOf"].([]any); ok {
		for _, a := range all {
			ref := a.(map[string]any)["$ref"].(string)
			p, r := o.members(strings.TrimPrefix(ref, "#/components/schemas/"))
			for k := range p {
				props[k] = true
			}
			required = append(required, r...)
		}
	}
	return props, required
}

// CheckMembers checks that v has exactly the members of the component
// schema name: all required ones, no other (a structural check; the Rust
// tests validate the views against the full schemas).
func (o *OpenAPI) CheckMembers(t *testing.T, name string, v any) {
	t.Helper()
	m, ok := v.(map[string]any)
	if !ok {
		t.Errorf("%s: not an object: %v", name, v)
		return
	}
	props, required := o.members(name)
	for _, r := range required {
		if _, ok := m[r]; !ok {
			t.Errorf("%s: no %s in %v", name, r, m)
		}
	}
	for k := range m {
		if !props[k] {
			t.Errorf("%s: unknown member %s", name, k)
		}
	}
}

// Cert is a certificate and its key written as PEM files.
type Cert struct {
	Cert *x509.Certificate
	Key  *ecdsa.PrivateKey
}

// NewCert makes a certificate (ECDSA P-256) for names (DNS names and IP
// addresses) with the EKUs serverAuth and clientAuth, signed by parent
// (nil: a CA signed by itself).
func NewCert(t *testing.T, cn string, names []string, parent *Cert) *Cert {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
	}
	for _, n := range names {
		if ip := net.ParseIP(n); ip != nil {
			tpl.IPAddresses = append(tpl.IPAddresses, ip)
		} else {
			tpl.DNSNames = append(tpl.DNSNames, n)
		}
	}
	signer, signerKey := tpl, key
	if parent == nil {
		tpl.IsCA = true
		tpl.BasicConstraintsValid = true
		tpl.KeyUsage = x509.KeyUsageCertSign
	} else {
		tpl.KeyUsage = x509.KeyUsageDigitalSignature
		tpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}
		signer, signerKey = parent.Cert, parent.Key
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, signer, &key.PublicKey, signerKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return &Cert{Cert: cert, Key: key}
}

// WriteApplicationCert writes c as the application certificate of the
// container storage root for the container name: the certificate
// /etc/oi4/certs/<name>.pem (with the chain) and the unencrypted PKCS#8
// key /run/secrets/oi4/private_key.pem (REQ-CNT-008/009).
func WriteApplicationCert(t *testing.T, root, name string, c *Cert, chain ...*Cert) {
	t.Helper()
	certs := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Cert.Raw})
	for _, p := range chain {
		certs = append(certs, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: p.Cert.Raw})...)
	}
	key, err := x509.MarshalPKCS8PrivateKey(c.Key)
	if err != nil {
		t.Fatal(err)
	}
	Write(t, filepath.Join(root, "etc", "oi4", "certs", name+".pem"), string(certs))
	Write(t, filepath.Join(root, "run", "secrets", "oi4", "private_key.pem"),
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key})))
	if err := os.Chmod(filepath.Join(root, "run", "secrets", "oi4", "private_key.pem"), 0o600); err != nil {
		t.Fatal(err)
	}
}

// PeerCertificate is the certificate the server on addr presents (not
// verified).
func PeerCertificate(t *testing.T, addr string) *x509.Certificate {
	t.Helper()
	c, err := tls.Dial("tcp", addr, &tls.Config{InsecureSkipVerify: true}) //nolint:gosec // the test inspects it
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.ConnectionState().PeerCertificates[0]
}

// Pinned is a client configuration that trusts only ca, for the server
// name.
func Pinned(ca *x509.Certificate, name string) *tls.Config {
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	return &tls.Config{RootCAs: pool, ServerName: name, MinVersion: tls.VersionTLS12}
}
