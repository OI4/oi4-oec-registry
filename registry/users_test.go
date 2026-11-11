package registry

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/OI4/oec/registry/internal/regtest"
)

// Integration tests of the user management of the HTTP side (ADR-0035,
// C-113 D-2): login, sessions, the forced password change, the users of
// an admin, the throttle, the store across a restart and the generated
// first password.

// call sends a JSON request with the session of w and checks the status;
// the decoded answer (nil without a body).
func call(t *testing.T, w *regtest.Web, method, path string, body any, want int) map[string]any {
	t.Helper()
	text := ""
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		text = string(raw)
	}
	resp, raw := w.Do(t, method, path, "application/json", text)
	if resp.StatusCode != want {
		t.Fatalf("%s %s: %d %s, want %d", method, path, resp.StatusCode, raw, want)
	}
	regtest.CheckHeaders(t, method+" "+path, resp)
	if len(raw) == 0 {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s %s: %v in %s", method, path, err, raw)
	}
	return out
}

// TestHTTPUsers: the user management over TLS on the API port.
func TestHTTPUsers(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	api := regtest.LoopbackAddr(t)
	p, _ := regtest.StartRegistry(t, b, root, il, "OEC_REGISTRY_API="+api)
	s := started{b: b, p: p, api: api}
	s.stderr(t, "HTTP: the user admin with the password of its file")
	cert := regtest.PeerCertificate(t, api)
	anon := regtest.WaitWeb(t, api, regtest.Pinned(cert, "reg-1"))
	doc := regtest.LoadOpenAPI(t)

	// without a session: 401 with WWW-Authenticate; the public resources
	for _, path := range []string{"/api/assets", "/api/events", "/api/data", "/api/session", "/api/users", "/api/stream"} {
		resp, _ := anon.Do(t, "GET", path, "", "")
		if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("WWW-Authenticate") != `Bearer realm="oec-registry"` {
			t.Errorf("GET %s without a session: %d %q", path, resp.StatusCode, resp.Header.Get("WWW-Authenticate"))
		}
	}
	for _, path := range []string{"/api/openapi.json", "/api/asyncapi.json"} {
		if resp, _ := anon.Do(t, "GET", path, "", ""); resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s without a session: %d", path, resp.StatusCode)
		}
	}

	// login: a wrong password and an unknown name look the same
	for _, c := range [][2]string{{"admin", "wrong password!"}, {"nobody", regtest.AdminPassword}} {
		got := call(t, anon, "POST", "/api/login", map[string]string{"name": c[0], "password": c[1]}, 401)
		if got["error"] != "wrong name or password" {
			t.Errorf("login %s: %v", c[0], got)
		}
	}
	resp, raw := anon.Do(t, "POST", "/api/login", "application/json", `{"name":"admin","password":"`+regtest.AdminPassword+`"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: %d %s", resp.StatusCode, raw)
	}
	var logged map[string]any
	if err := json.Unmarshal(raw, &logged); err != nil {
		t.Fatal(err)
	}
	doc.CheckMembers(t, "LoggedIn", logged)
	token, _ := logged["token"].(string)
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(token) || logged["role"] != "admin" || logged["mustChange"] != false {
		t.Errorf("login: %v", logged)
	}
	if got, want := resp.Header.Get("Set-Cookie"), "__Host-oec_session="+token+"; Path=/; Secure; HttpOnly; SameSite=Strict"; got != want {
		t.Errorf("Set-Cookie %q, want %q", got, want)
	}
	// the cookie is a session too
	req, _ := http.NewRequest("GET", "https://"+api+"/api/session", nil)
	req.Header.Set("Cookie", "other=1; __Host-oec_session="+token)
	if resp, err := anon.Client().Do(req); err != nil || resp.StatusCode != http.StatusOK {
		t.Errorf("GET /api/session with the cookie: %v %v", resp, err)
	} else {
		resp.Body.Close()
	}
	admin := &regtest.Web{Addr: api, TLS: anon.TLS, Token: token}
	doc.CheckMembers(t, "User", call(t, admin, "GET", "/api/session", nil, 200))

	// the bodies
	for _, c := range []struct {
		contentType, body string
		want              int
	}{
		{"text/plain", `{}`, 415},
		{"", `{}`, 415},
		{"application/json", `[]`, 400},
		{"application/json", `{"name":"jane","role":"user"}`, 400},
		{"application/json", `{"name":"jane","role":"user","password":"jane initial pw","x":"1"}`, 400},
		{"application/json", `{"name":"jane","role":"user","password":12}`, 400},
		{"application/json", `{"name":"jane","role":"boss","password":"jane initial pw"}`, 400},
		{"application/json", `{"name":"ja ne","role":"user","password":"jane initial pw"}`, 400},
		{"application/json", `{"name":"jane","role":"user","password":"short"}`, 400},
		{"application/json", `{"name":"jane","role":"user","password":"JANE"}`, 400},
		{"application/json", `{"name":"jane","role":"user","password":"` + strings.Repeat("x", regtest.HTTPMaxJSON) + `"}`, 413},
	} {
		resp, raw := admin.Do(t, "POST", "/api/users", c.contentType, c.body)
		if resp.StatusCode != c.want {
			body := c.body
			if len(body) > 80 {
				body = body[:80]
			}
			t.Errorf("POST /api/users %q %s: %d %s, want %d", c.contentType, body, resp.StatusCode, raw, c.want)
		}
	}

	// a user, its forced password change
	jane := call(t, admin, "POST", "/api/users", map[string]string{"name": "jane", "role": "user", "password": "jane initial pw"}, 201)
	doc.CheckMembers(t, "User", jane)
	if jane["mustChange"] != true || jane["role"] != "user" {
		t.Errorf("new user: %v", jane)
	}
	call(t, admin, "POST", "/api/users", map[string]string{"name": "jane", "role": "user", "password": "jane initial pw"}, 409)
	j := anon.As(t, "jane", "jane initial pw")
	call(t, j, "GET", "/api/assets", nil, 403)
	call(t, j, "GET", "/api/users", nil, 403)
	if got := call(t, j, "GET", "/api/session", nil, 200); got["mustChange"] != true {
		t.Errorf("session: %v", got)
	}
	call(t, j, "POST", "/api/password", map[string]string{"current": "wrong password!", "new": "jane secret pw"}, 403)
	call(t, j, "POST", "/api/password", map[string]string{"current": "jane initial pw", "new": "jane initial pw"}, 400)
	other := anon.As(t, "jane", "jane initial pw")
	if got := call(t, j, "POST", "/api/password", map[string]string{"current": "jane initial pw", "new": "jane secret pw"}, 200); got["mustChange"] != false {
		t.Errorf("password change: %v", got)
	}
	call(t, other, "GET", "/api/session", nil, 401)
	call(t, j, "GET", "/api/assets", nil, 200)
	call(t, j, "GET", "/api/users", nil, 403)
	call(t, j, "POST", "/api/users", map[string]string{"name": "x", "role": "admin", "password": "jane secret pw"}, 403)
	call(t, j, "DELETE", "/api/users/admin", nil, 403)

	// the users of an admin
	list := call(t, admin, "GET", "/api/users", nil, 200)
	doc.CheckMembers(t, "Users", list)
	if n := len(list["users"].([]any)); n != 2 {
		t.Errorf("users: %v", list)
	}
	if strings.Contains(string(mustRead(t, filepath.Join(root, "etc/oi4/app/registry/users.json"))), "jane secret pw") {
		t.Error("users.json holds a password")
	}
	if fi, err := os.Stat(filepath.Join(root, "etc/oi4/app/registry/users.json")); err != nil || fi.Mode().Perm() != 0o600 {
		t.Errorf("users.json: %v %v", fi, err)
	}
	call(t, admin, "PUT", "/api/users/admin", map[string]string{"role": "user"}, 409)
	call(t, admin, "DELETE", "/api/users/admin", nil, 409)
	call(t, admin, "PUT", "/api/users/nobody", map[string]string{"role": "user"}, 404)
	call(t, admin, "PUT", "/api/users/jane", map[string]string{}, 400)

	// an admin sets the password: the sessions of the user end, also its
	// event stream
	stream := j.Stream(t)
	stream.Event(t, 0, "snapshot", nil)
	if got := call(t, admin, "PUT", "/api/users/jane", map[string]string{"password": "jane reset pw!"}, 200); got["mustChange"] != true {
		t.Errorf("reset: %v", got)
	}
	call(t, j, "GET", "/api/session", nil, 401)
	select {
	case <-stream.Ended():
	case <-time.After(regtest.Wait):
		t.Error("the event stream outlives its session")
	}
	call(t, admin, "PUT", "/api/users/jane", map[string]string{"role": "admin"}, 200)
	call(t, admin, "POST", "/api/users", map[string]string{"name": "bob@acme", "role": "user", "password": "bob initial pw"}, 201)
	call(t, admin, "DELETE", "/api/users/jane", nil, 204)
	call(t, admin, "DELETE", "/api/users/jane", nil, 404)

	// logout
	resp, _ = admin.Do(t, "POST", "/api/logout", "", "")
	if resp.StatusCode != http.StatusNoContent || !strings.Contains(resp.Header.Get("Set-Cookie"), "__Host-oec_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0") {
		t.Errorf("logout: %d %q", resp.StatusCode, resp.Header.Get("Set-Cookie"))
	}
	call(t, admin, "GET", "/api/session", nil, 401)

	// the throttle: 5 wrong passwords, then 429 also for the right one
	for i := 0; i < 5; i++ {
		call(t, anon, "POST", "/api/login", map[string]string{"name": "admin", "password": "wrong password!"}, 401)
	}
	resp, _ = anon.Do(t, "POST", "/api/login", "application/json", `{"name":"admin","password":"`+regtest.AdminPassword+`"}`)
	if retry, _ := strconv.Atoi(resp.Header.Get("Retry-After")); resp.StatusCode != http.StatusTooManyRequests || retry < 1 || retry > 60 {
		t.Errorf("login after 5 failures: %d, Retry-After %q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}

	// the store survives a restart; the password file is not read again
	if err := p.Stop(t); err != nil {
		t.Logf("stop: %v", err)
	}
	regtest.Write(t, filepath.Join(root, "run/secrets/oi4/registry_admin_password"), "another admin password\n")
	p, _ = regtest.StartRegistry(t, b, root, il, "OEC_REGISTRY_API="+api)
	s = started{b: b, p: p, api: api}
	s.stderr(t, "HTTP: 2 users")
	// a new self-signed certificate
	again := regtest.WaitWeb(t, api, regtest.Pinned(regtest.PeerCertificate(t, api), "reg-1"))
	bob := again.As(t, "bob@acme", "bob initial pw")
	if got := call(t, bob, "GET", "/api/session", nil, 200); got["mustChange"] != true || got["name"] != "bob@acme" {
		t.Errorf("bob after the restart: %v", got)
	}
	again.As(t, "admin", regtest.AdminPassword)
}

// TestHTTPGeneratedPassword: without the password file the first admin
// gets a generated password, printed once on stderr (never in the log on
// the bus), to be changed at the first login.
func TestHTTPGeneratedPassword(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	if err := os.Remove(filepath.Join(root, "run/secrets/oi4/registry_admin_password")); err != nil {
		t.Fatal(err)
	}
	web := regtest.LoopbackAddr(t)
	p, _ := regtest.StartRegistry(t, b, root, il, "OEC_REGISTRY_WEB="+web, "OEC_REGISTRY_TLS=off")
	s := started{b: b, p: p, web: web}
	s.stderr(t, "the password of the user admin: ")
	m := regexp.MustCompile(`the password of the user admin: (\S+)`).FindStringSubmatch(p.Stderr())
	if m == nil || len(m[1]) != 20 {
		t.Fatalf("generated password: %v", m)
	}
	for _, x := range b.Events() {
		if strings.Contains(x.Payload, m[1]) {
			t.Fatalf("the password is on the bus: %s", x.Topic)
		}
	}
	w := regtest.WaitWeb(t, web, nil)
	resp, _ := w.Do(t, "POST", "/api/login", "application/json", `{"name":"admin","password":"`+m[1]+`"}`)
	if c := resp.Header.Get("Set-Cookie"); !strings.HasPrefix(c, "oec_session=") || strings.Contains(c, "Secure") {
		t.Errorf("plain HTTP cookie: %q", c)
	}
	if got := w.Login(t, "admin", m[1]); got["mustChange"] != true {
		t.Errorf("login: %v", got)
	}
	call(t, w, "GET", "/api/assets", nil, 403)
	call(t, w, "POST", "/api/password", map[string]string{"current": m[1], "new": "a new admin password"}, 200)
	call(t, w, "GET", "/api/assets", nil, 200)
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
