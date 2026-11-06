// Integration tests of the OEC Registry (ADR-0029 §11, A-387): the
// registry binary on the test broker, judged by D8 (`oec-infra bus`,
// T8-BUS-03) and D7 (`oec-check test`), both run as programs (ADR-0006).
package registry

import (
	"strconv"
	"strings"
	"testing"

	"github.com/OI4/oec/registry/internal/regtest"
)

// il is the Identification Link of the registry in the tests: the product
// of src/main.rs and the hostname of the container storage, dnp-encoded
// (MG 4.1, SF-104).
const il = "oi4.org/OEC,20Registry/OEC-REGISTRY/reg-1"

// TestD8Registry: D8 T8-BUS-03 (REQ-REG-001, REQ-REG-002) passes against
// the registry – two probe components with Birth, a second Health, Close
// and Will; their MAM and last Health in the answers to Get MAM and Get
// Health with and without Source while available, neither afterwards.
// On the wire the registry subscribes to the MAM, Health, Profile, Event,
// PublicationList and SubscriptionList of every participant (ADR-0029 §4)
// and publishes only Pub of its own and Get to others (read-only,
// ADR-0008), every topic and subscription a channel of api/asyncapi.json.
func TestD8Registry(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	_, birth := regtest.StartRegistry(t, b, root, il)
	tests, code := regtest.D8Bus(t, b, il, "T8-BUS-03")
	if len(tests) != 1 || tests[0].ID != "T8-BUS-03" || tests[0].Outcome != "pass" || code != 0 {
		t.Errorf("exit %d, tests %+v", code, tests)
	}
	conn := birth.Conn
	gets := 0
	collecting := map[string]bool{}
	for _, r := range []string{"MAM", "Health", "Profile", "Event", "PublicationList", "SubscriptionList"} {
		collecting["Oi4v2/+/+/Pub/"+r+"/#"] = false
	}
	for _, s := range b.Events() {
		if s.Conn == conn && s.Seen == "subscribe" {
			for _, f := range s.Filters {
				if _, ok := collecting[f]; ok {
					collecting[f] = true
				}
			}
		}
		if s.Conn != conn || s.Seen != "publish" {
			continue
		}
		lv := strings.Split(s.Topic, "/")
		if len(lv) < 5 {
			t.Errorf("topic %s", s.Topic)
			continue
		}
		own := lv[1] == "Registry" && lv[2] == regtest.Topic(il)
		switch {
		case own && lv[3] == "Pub":
		case !own && lv[3] == "Get":
			gets++
		default:
			t.Errorf("the registry published on %s (read-only: Pub of its own, Get to others)", s.Topic)
		}
	}
	for f, ok := range collecting {
		if !ok {
			t.Errorf("the registry does not subscribe to %s (ADR-0029 §4)", f)
		}
	}
	t.Logf("%d Get requests of the registry to others", gets)
	n := regtest.CheckWire(t, regtest.LoadAPI(t, il), b.Events(), map[int]bool{conn: true})
	t.Logf("%d publications of the registry match api/asyncapi.json", n)
}

// TestD7Level3: D7 `oec-check test --level 3` against the registry
// (ADR-0029 §2, A-389, all 55 tests of Levels 1 … 3): no test fails and
// the tests of d7Level3Pass pass; every topic the registry publishes and
// every subscription is a channel of api/asyncapi.json (ADR-0029 §8).
func TestD7Level3(t *testing.T) {
	b := regtest.RunD7(t, regtest.D7{
		Exe:      regtest.Registry(t),
		Env:      regtest.HTTPOff,
		Hostname: "reg-1",
		App:      "Registry/" + il,
		Level:    3,
		Pass:     d7Level3Pass,
		Report:   "OEC_REGISTRY_D7_REPORT",
	})
	conns := map[int]bool{}
	for _, s := range b.Events() {
		if s.Seen == "connect" && s.ClientID == "reg-1" {
			conns[s.Conn] = true
		}
	}
	if len(conns) == 0 {
		t.Fatal("no connection of the registry (ClientID reg-1)")
	}
	n := regtest.CheckWire(t, regtest.LoadAPI(t, il), b.Events(), conns)
	t.Logf("%d publications of the registry on %d connections match api/asyncapi.json", n, len(conns))
}

// d7Level3Pass: the 49 D7 tests that pass against the registry (C-087).
// D7 skips six: T7-MON-07, T7-MON-17 and T7-ADR-02 judge requests of the
// CUT to others with ReplyTo or a second namespace (the registry's Get
// carry none, there is one namespace); T7-MON-09 judges Data and Metadata
// (the registry publishes no Data of its own beyond its Config); T7-SET-04
// needs a Del D7 can restore; T7-SET-10 needs a ReferenceDesignation
// object (a fresh registry has none). T7-GET-04, T7-MON-04 and T7-SET-03
// pass with the D7 refinement for registries (A-388, ADR-0025 amendment
// C-087): only the registry itself is an entity, the listed assets are not.
var d7Level3Pass = []string{
	"T7-MON-01", "T7-MON-02", "T7-MON-03", "T7-MON-04", "T7-MON-05", "T7-MON-06", "T7-MON-08", "T7-MON-10", "T7-MON-11", "T7-MON-12", "T7-MON-13", "T7-MON-14", "T7-MON-15", "T7-MON-16", "T7-MON-18", "T7-MON-19",
	"T7-CON-01", "T7-CON-02", "T7-CON-03", "T7-CON-04",
	"T7-LIFE-01", "T7-LIFE-02", "T7-LIFE-03", "T7-LIFE-04",
	"T7-ADR-01", "T7-ADR-03",
	"T7-GET-01", "T7-GET-02", "T7-GET-03", "T7-GET-04", "T7-GET-05", "T7-GET-06", "T7-GET-07", "T7-GET-08", "T7-GET-09",
	"T7-SET-01", "T7-SET-02", "T7-SET-03", "T7-SET-05", "T7-SET-06", "T7-SET-07", "T7-SET-08", "T7-SET-09", "T7-SET-11", "T7-SET-12",
	"T7-ACT-01", "T7-ACT-02", "T7-ACT-03", "T7-ACT-04",
}

// TestReferenceDesignationPersists: the registry at Level 3 accepts a Set
// ReferenceDesignation about itself (REQ-CMP-020) and still answers it
// after a restart on the same container storage (REQ-RES-REFDES-002, the
// file store of the SDK in the application volume, ADR-0029 §3). D7
// T7-SET-10 skips this against a fresh storage.
func TestReferenceDesignationPersists(t *testing.T) {
	b := regtest.StartBroker(t)
	root := b.Container(t, "reg-1")
	from := b.Len()
	p, birth := regtest.StartRegistry(t, b, root, il)
	// the DataSetWriterId of the ReferenceDesignation, from the
	// PublicationList of the start
	list, _ := b.Publish(t, from, regtest.RegistryTopic(il, "Pub", "PublicationList", ""))
	writer := -1.0
	for _, m := range regtest.AsJSON(t, list.Payload)["Messages"].([]any) {
		entry := m.(map[string]any)["Payload"].(map[string]any)
		if entry["Resource"] == "ReferenceDesignation" && entry["Source"] == il {
			writer = entry["DataSetWriterId"].(float64)
		}
	}
	if writer < 10 {
		t.Fatalf("no ReferenceDesignation in the PublicationList: %s", list.Payload)
	}
	const peer = "Utility/acme.com/RegistryTest/RT-1/1"
	message := func(class, messages string) string {
		return `{"MessageId": "1639693510000-` + peer + `", "MessageType": "ua-data", "PublisherId": "` + peer +
			`", "DataSetClassId": "` + class + `", "ReplyTo": "", "Messages": [` + messages + `]}`
	}
	const class = "27a75019-164a-496d-a38b-90e8a55c2cfa"
	set := message(class, `{"DataSetWriterId": `+strconv.Itoa(int(writer))+`, "WriterGroupName": "", "DataSetWriterName": "`+il+
		`", "Payload": {"Location": {"Value": "+P1.H3.R2", "Local": "+R2"}}}`)
	answer := regtest.RegistryTopic(il, "Pub", "ReferenceDesignation", il)
	from = b.Len()
	b.Send(t, birth.Conn, regtest.RegistryTopic(il, "Set", "ReferenceDesignation", il), set)
	b.Publish(t, from, regtest.RegistryTopic(il, "Pub", "Event", il)+"/Status/Good")
	if err := p.Stop(t); err != nil {
		t.Fatalf("exit: %v", err)
	}
	_, birth = regtest.StartRegistry(t, b, root, il)
	from = b.Len()
	b.Send(t, birth.Conn, regtest.RegistryTopic(il, "Get", "ReferenceDesignation", il), message(class, ""))
	got, _ := b.Publish(t, from, answer)
	if !strings.Contains(got.Payload, `"+P1.H3.R2"`) {
		t.Errorf("after the restart: %s", got.Payload)
	}
}
