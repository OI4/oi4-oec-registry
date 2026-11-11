package registry

import (
	"bytes"
	"crypto/x509"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"slices"
	"strings"
	"testing"

	"github.com/OI4/oec/registry/internal/regtest"
	"github.com/OI4/oec/registry/internal/uipolicy"
)

// Integration tests of the HTTP side of the registry (ADR-0029 §7, §11,
// A-398 ff.): REST read-only, the event stream, OpenAPI, TLS and the ports,
// against the running registry on the test broker; Go standard library
// only. The user management (ADR-0035): users_test.go.

// peer is a participant the tests announce to the registry.
const peer = "acme.com/RegistryTest/RT-1/1"

// announce sends the Birth of peer (MAM, Health) and an Event to the
// registry on its connection conn.
func announce(t *testing.T, b *regtest.Broker, conn int) {
	t.Helper()
	message := func(class, payload string) string {
		return `{"MessageId": "1639693510000-Utility/` + peer + `", "MessageType": "ua-data", "PublisherId": "Utility/` + peer +
			`", "DataSetClassId": "` + class + `", "ReplyTo": "", "Messages": [{"DataSetWriterId": 10, "WriterGroupName": "", "DataSetWriterName": "` +
			peer + `", "Payload": ` + payload + `}]}`
	}
	base := "Oi4v2/Utility/" + regtest.Topic(peer) + "/Pub/"
	b.Send(t, conn, base+"MAM/"+regtest.Topic(peer), message("360ca8f3-5e66-42a2-8f10-9cdf45f4bf58", `{
		"Manufacturer": {"Locale": "en-US", "Text": "ACME"}, "ManufacturerUri": "acme.com",
		"Model": {"Locale": "en-US", "Text": "RegistryTest"}, "ProductCode": "RT-1",
		"HardwareRevision": "", "SoftwareRevision": "1.0.0", "DeviceRevision": "",
		"DeviceManual": "", "DeviceClass": "Oi4.Utility", "SerialNumber": "1",
		"ProductInstanceUri": "`+peer+`", "RevisionCounter": 0}`))
	b.Send(t, conn, base+"Health/"+regtest.Topic(peer), message("d8e7b6df-42ba-448a-975a-199f59e8ffeb",
		`{"Health": "NORMAL_0", "HealthScore": 100}`))
	b.Send(t, conn, base+"Event/"+regtest.Topic(peer)+"/Status/Good", message("543ae05e-b6d9-4161-a0a3-350a0fac5976",
		`{"Number": 0, "Category": "CAT_STATUS_1", "Description": "Good"}`))
	b.Send(t, conn, base+"Data/"+regtest.Topic(peer)+"/Level", `{"MessageId": "1639693510001-Utility/`+peer+
		`", "MessageType": "ua-data", "PublisherId": "Utility/`+peer+`", "ReplyTo": "", "Messages": [{"DataSetWriterId": 11, "MessageType": "ua-keyframe", `+
		`"WriterGroupName": "Level", "DataSetWriterName": "`+peer+`", "Payload": {"Level": 42.5}}]}`)
}

// started is a registry with the HTTP side on two loopback ports.
type started struct {
	b        *regtest.Broker
	p        *regtest.Process
	conn     int
	web, api string
}

// stderr waits for a line of the registry log that contains text.
func (s started) stderr(t *testing.T, text string) {
	t.Helper()
	regtest.Eventually(t, "registry log: "+text, func() bool { return strings.Contains(s.p.Stderr(), text) })
}

// TestHTTPSelfSigned: without an application certificate the registry
// serves HTTPS with a certificate signed by itself (REQ-REG-007, ADR-0029
// §7) for its names; the REST resources, the event stream, the documents
// and the guards and limits of ADR-0028 amendment C-083 on both ports.
func TestHTTPSelfSigned(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	web, api := regtest.LoopbackAddr(t), regtest.LoopbackAddr(t)
	p, birth := regtest.StartRegistry(t, b, root, il,
		"OEC_REGISTRY_WEB="+web, "OEC_REGISTRY_API="+api, "OEC_REGISTRY_KEEPALIVE_MS=300", "OEC_REGISTRY_HOSTS=registry.local")
	s := started{b: b, p: p, conn: birth.Conn, web: web, api: api}
	s.stderr(t, "HTTP: TLS with a self-signed certificate")
	s.stderr(t, "HTTP: Web UI and API on https://"+web)
	s.stderr(t, "HTTP: API on https://"+api)

	cert := regtest.PeerCertificate(t, web)
	if !bytes.Equal(cert.RawIssuer, cert.RawSubject) || cert.CheckSignature(cert.SignatureAlgorithm, cert.RawTBSCertificate, cert.Signature) != nil {
		t.Errorf("not signed by itself: issuer %s, subject %s", cert.Issuer, cert.Subject)
	}
	for _, n := range []string{"localhost", "reg-1", "registry.local"} {
		if !slices.Contains(cert.DNSNames, n) {
			t.Errorf("DNS names %v without %s", cert.DNSNames, n)
		}
	}
	for _, ip := range []string{"127.0.0.1", "::1"} {
		if !slices.ContainsFunc(cert.IPAddresses, func(a net.IP) bool { return a.Equal(net.ParseIP(ip)) }) {
			t.Errorf("IP addresses %v without %s", cert.IPAddresses, ip)
		}
	}
	if !slices.Contains(cert.ExtKeyUsage, x509.ExtKeyUsageServerAuth) {
		t.Errorf("EKU %v without serverAuth", cert.ExtKeyUsage)
	}
	if other := regtest.PeerCertificate(t, api); !other.Equal(cert) {
		t.Error("the ports present different certificates")
	}
	w := regtest.WaitWeb(t, web, regtest.Pinned(cert, "localhost"))
	a := regtest.WaitWeb(t, api, regtest.Pinned(cert, "reg-1"))
	s.stderr(t, "HTTP: the user admin with the password of its file")
	w.Login(t, "admin", regtest.AdminPassword)
	a.Login(t, "admin", regtest.AdminPassword)

	// no plain HTTP on a TLS port
	c, err := net.Dial("tcp", api)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = c.Write([]byte("GET /api/assets HTTP/1.1\r\nHost: " + api + "\r\n\r\n"))
	reply := make([]byte, 12)
	n, _ := c.Read(reply)
	c.Close()
	if strings.HasPrefix(string(reply[:n]), "HTTP/1.1 2") {
		t.Errorf("plain HTTP on the TLS port: %q", reply[:n])
	}

	checkContent(t, s, w, a)
	t.Run("guards", func(t *testing.T) {
		a.CheckGuards(t, "/api/assets")
		w.CheckGuards(t, "/api/events")
	})
	t.Run("slow", w.CheckSlow)
	t.Run("keep-alive", a.CheckKeepAlive)
	t.Run("limits", a.CheckLimits)
	if t.Failed() {
		t.Logf("registry stderr:\n%s", p.Stderr())
	}
}

// checkContent: the resources of the API with an announced participant;
// the event stream sends the snapshot and then the changes; the documents
// are the files of api/; every path of the OpenAPI document answers.
func checkContent(t *testing.T, s started, w, a *regtest.Web) {
	t.Helper()
	doc := regtest.LoadOpenAPI(t)

	stream := a.Stream(t)
	defer stream.Close()
	snap, i := stream.Event(t, 0, "snapshot", nil)
	doc.CheckMembers(t, "SnapshotMessage", snap)

	announce(t, s.b, s.conn)

	got, _ := stream.Event(t, i, "asset", func(m map[string]any) bool {
		as, _ := m["asset"].(map[string]any)
		return as != nil && as["il"] == peer && as["health"] != nil
	})
	doc.CheckMembers(t, "AssetMessage", got)
	got, _ = stream.Event(t, i, "event", func(m map[string]any) bool {
		e, _ := m["event"].(map[string]any)
		return e != nil && e["source"] == peer
	})
	doc.CheckMembers(t, "EventMessage", got)
	doc.CheckMembers(t, "EventRecord", got["event"])

	var assets map[string]any
	a.JSON(t, "/api/assets", &assets)
	doc.CheckMembers(t, "Assets", assets)
	var found map[string]any
	for _, x := range assets["assets"].([]any) {
		doc.CheckMembers(t, "Summary", x)
		if x.(map[string]any)["il"] == peer {
			found = x.(map[string]any)
		}
	}
	if found == nil || found["kind"] != "application" || found["available"] != true || found["serviceType"] != "Utility" {
		t.Errorf("/api/assets: %v", found)
	}
	if assets["registry"] != il {
		t.Errorf("/api/assets: registry %v", assets["registry"])
	}

	var asset map[string]any
	w.JSON(t, "/api/assets/"+url.PathEscape(peer), &asset)
	doc.CheckMembers(t, "Asset", asset)
	if asset["il"] != peer || asset["mam"].(map[string]any)["ProductCode"] != "RT-1" {
		t.Errorf("/api/assets/{il}: %v", asset)
	}
	if resp, _ := a.Do(t, "GET", "/api/assets/"+url.PathEscape("acme.com/Nope/N-1/1"), "", ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("an unknown asset: %d", resp.StatusCode)
	}

	var events map[string]any
	a.JSON(t, "/api/events", &events)
	doc.CheckMembers(t, "Events", events)
	if !slices.ContainsFunc(events["events"].([]any), func(e any) bool {
		m := e.(map[string]any)
		return m["source"] == peer && m["filter"] == "Status/Good"
	}) {
		t.Errorf("/api/events: %v", events)
	}

	// the data logger (ADR-0029 amendment 2026-11-28, addendum 1)
	regtest.Eventually(t, "the peer's Data in /api/data", func() bool {
		var data map[string]any
		a.JSON(t, "/api/data", &data)
		doc.CheckMembers(t, "Data", data)
		for _, x := range data["dataSets"].([]any) {
			doc.CheckMembers(t, "DataRecord", x)
			m := x.(map[string]any)
			if m["source"] == peer && m["filter"] == "Level" && m["dataSetWriterId"] == 11.0 {
				return m["payload"].(map[string]any)["Level"] == 42.5
			}
		}
		return false
	})

	for file, path := range map[string]string{"api/openapi.json": "/api/openapi.json", "api/asyncapi.json": "/api/asyncapi.json"} {
		want, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		resp, body := a.Do(t, "GET", path, "", "")
		if resp.StatusCode != http.StatusOK || !bytes.Equal(body, want) || resp.Header.Get("Content-Type") != "application/json" {
			t.Errorf("GET %s: %d, %s, %d octets (want %s)", path, resp.StatusCode, resp.Header.Get("Content-Type"), len(body), file)
		}
	}

	// every path of the document with GET answers 200 (the stream: above;
	// the others: users_test.go)
	for _, p := range doc.Paths() {
		if p == "/api/stream" || !slices.Contains(doc.Methods(p), "GET") {
			continue
		}
		p = strings.Replace(p, "{il}", url.PathEscape(peer), 1)
		if resp, _ := a.Do(t, "GET", p, "", ""); resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s: %d", p, resp.StatusCode)
		}
	}

	checkUI(t, w, a)
}

// checkUI: the Web UI (ui/dist/, ADR-0029 §9, C-089) is served on the Web
// UI port only, every file with its bytes, its content type and the
// headers of the hardening contract; / is index.html; other paths are 404.
func checkUI(t *testing.T, w, a *regtest.Web) {
	t.Helper()
	names, err := uipolicy.Dist("ui")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(names, "index.html") || len(names) < 3 {
		t.Fatalf("ui/dist: %v", names)
	}
	index, err := os.ReadFile("ui/dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range append([]string{""}, names...) {
		p, file := "/"+n, n
		if n == "" {
			file = "index.html"
		}
		want, err := os.ReadFile("ui/dist/" + file)
		if err != nil {
			t.Fatal(err)
		}
		resp, body := w.Do(t, "GET", p, "", "")
		ct := uipolicy.Types[path.Ext(file)]
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != ct || !bytes.Equal(body, want) {
			t.Errorf("GET %s on the Web UI port: %d %q, %d octets (want %q, %s)", p, resp.StatusCode, resp.Header.Get("Content-Type"), len(body), ct, file)
		}
		regtest.CheckHeaders(t, "GET "+p, resp)
		if resp, _ := a.Do(t, "GET", p, "", ""); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s on the API port: %d", p, resp.StatusCode)
		}
	}
	if !bytes.Contains(index, []byte(`<div id="root">`)) || !bytes.Contains(index, []byte(`<script type="module" crossorigin src="/assets/`)) {
		t.Errorf("ui/dist/index.html is not the Web UI:\n%s", index)
	}
	for _, p := range []string{"/assets/", "/assets/nope.js", "/index.htm", "/dist/index.html", "/favicon.svg/x"} {
		if resp, _ := w.Do(t, "GET", p, "", ""); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s on the Web UI port: %d", p, resp.StatusCode)
		}
	}
	// a request of the module script carries Origin (crossorigin): same
	// origin passes, another is 403
	for origin, want := range map[string]int{w.Scheme() + "://" + w.Addr: http.StatusOK, "https://evil.example": http.StatusForbidden} {
		req, err := http.NewRequest("GET", w.Scheme()+"://"+w.Addr+"/"+names[0], nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", origin)
		resp, err := w.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("GET /%s with Origin %s: %d, want %d", names[0], origin, resp.StatusCode, want)
		}
	}
}

// TestHTTPApplicationCertificate: with the application certificate of the
// container storage (REQ-CNT-008) the registry serves HTTPS with it
// (REQ-REG-007); a client that trusts the CA of the certificate verifies
// it for the container name.
func TestHTTPApplicationCertificate(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	ca := regtest.NewCert(t, "Registry Test CA", nil, nil)
	leaf := regtest.NewCert(t, "reg-1", []string{"reg-1", "localhost", "127.0.0.1"}, ca)
	regtest.WriteApplicationCert(t, root, "reg-1", leaf, ca)
	api := regtest.LoopbackAddr(t)
	p, _ := regtest.StartRegistry(t, b, root, il, "OEC_REGISTRY_API="+api)
	s := started{b: b, p: p, api: api}
	s.stderr(t, "HTTP: TLS with the application certificate")
	s.stderr(t, "HTTP: API on https://"+api)
	if strings.Contains(p.Stderr(), "HTTP: Web UI") {
		t.Error("the Web UI port is on without OEC_REGISTRY_WEB")
	}
	if got := regtest.PeerCertificate(t, api); !got.Equal(leaf.Cert) {
		t.Errorf("the registry presents %s, not the application certificate", got.Subject)
	}
	a := regtest.WaitWeb(t, api, regtest.Pinned(ca.Cert, "reg-1"))
	a.Login(t, "admin", regtest.AdminPassword)
	var assets map[string]any
	a.JSON(t, "/api/assets", &assets)
	if assets["registry"] != il {
		t.Errorf("/api/assets: %v", assets)
	}
}

// TestHTTPPlain: plain HTTP only with OEC_REGISTRY_TLS=off (development,
// with a warning); the Web UI port only, the API port off.
func TestHTTPPlain(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	web := regtest.LoopbackAddr(t)
	p, birth := regtest.StartRegistry(t, b, root, il, "OEC_REGISTRY_WEB="+web, "OEC_REGISTRY_TLS=off")
	s := started{b: b, p: p, conn: birth.Conn, web: web}
	s.stderr(t, "HTTP: Web UI and API on http://"+web)
	if !strings.Contains(p.Stderr(), "plain") {
		t.Errorf("no warning about plain HTTP:\n%s", p.Stderr())
	}
	if strings.Contains(p.Stderr(), "HTTP: API on") {
		t.Error("the API port is on")
	}
	w := regtest.WaitWeb(t, web, nil)
	w.Login(t, "admin", regtest.AdminPassword)
	announce(t, b, birth.Conn)
	regtest.Eventually(t, "the peer in /api/assets", func() bool {
		var assets map[string]any
		w.JSON(t, "/api/assets", &assets)
		for _, x := range assets["assets"].([]any) {
			if x.(map[string]any)["il"] == peer {
				return true
			}
		}
		return false
	})
	w.CheckGuards(t, "/api/assets")
	stream := w.Stream(t)
	stream.Event(t, 0, "snapshot", nil)
}

// TestHTTPSettings: invalid HTTP settings, a port in use and a missing
// or weak password file of the first user (ADR-0035) end the registry
// with an error before it connects; both ports off is allowed.
func TestHTTPSettings(t *testing.T) {
	b := regtest.StartBroker(t)
	used, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer used.Close()
	free := regtest.LoopbackAddr(t)
	for _, tc := range []struct {
		env  []string
		want string
	}{
		{[]string{"OEC_REGISTRY_WEB=" + free, "OEC_REGISTRY_API=" + free}, "OEC_REGISTRY_WEB and OEC_REGISTRY_API"},
		{[]string{"OEC_REGISTRY_API=nowhere"}, "OEC_REGISTRY_API"},
		{[]string{"OEC_REGISTRY_TLS=maybe"}, "OEC_REGISTRY_TLS"},
		{[]string{"OEC_REGISTRY_KEEPALIVE_MS=0"}, "OEC_REGISTRY_KEEPALIVE_MS"},
		{[]string{"OEC_REGISTRY_API=" + used.Addr().String()}, used.Addr().String()},
		{[]string{"OEC_REGISTRY_API=" + free, "OEC_REGISTRY_ADMIN_PASSWORD_FILE=/nonexistent/password"}, "/nonexistent/password"},
		{[]string{"OEC_REGISTRY_API=" + free, "weak"}, "12 … 256 characters"},
	} {
		root := b.Container(t, "reg-1")
		if tc.env[len(tc.env)-1] == "weak" {
			tc.env = tc.env[:len(tc.env)-1]
			regtest.Write(t, root+"/run/secrets/oi4/registry_admin_password", "short\n")
		}
		env := append(append([]string{"OEC_ROOT=" + root}, regtest.HTTPOff...), tc.env...)
		p := regtest.Start(t, regtest.Registry(t), env...)
		if err := p.Exit(t); err == nil {
			t.Errorf("%v: exit 0", tc.env)
		}
		if !strings.Contains(p.Stderr(), tc.want) {
			t.Errorf("%v: no %q in:\n%s", tc.env, tc.want, p.Stderr())
		}
		for _, s := range b.Events() {
			if s.Seen == "connect" && s.ClientID == "reg-1" {
				t.Fatalf("%v: the registry connected", tc.env)
			}
		}
	}
	// both off: the registry runs without HTTP
	p, _ := regtest.StartRegistry(t, b, b.Container(t, "reg-1"), il)
	regtest.Eventually(t, "HTTP: off", func() bool { return strings.Contains(p.Stderr(), "HTTP: off") })
}
