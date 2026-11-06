package regtest

import "testing"

// TestAPI: the channels of api/asyncapi.json as the wire check reads them –
// the own topics of the registry, the Pub of others it collects and the Get
// it sends; a Set, Del or Call to others is no channel (read-only, ADR-0008).
func TestAPI(t *testing.T) {
	const me = "oi4.org/OEC,20Registry/OEC-REGISTRY/reg-1"
	api := LoadAPI(t, me)
	own := "Oi4v2/Registry/" + Topic(me)
	other := "Oi4v2/Utility/" + Topic("acme.com/X/Y/1")
	src := Topic("acme.com/X/Y/2")
	for _, c := range []struct{ action, topic, want string }{
		{"send", own + "/Pub/MAM", "pubMam"},
		{"send", own + "/Pub/Event/" + src + "/Status/Good", "pubEventSourceFilter"},
		{"send", own + "/Reply/NewDataSetWriterId/" + src, "replyNewDataSetWriterIdSource"},
		{"receive", own + "/Get/Config/" + src + "/registry", "getConfigSourceFilter"},
		{"receive", own + "/Set/ReferenceDesignation/" + src, "setReferenceDesignationSource"},
		{"receive", own + "/Set/ReferenceDesignation", ""},
		{"receive", own + "/Call/NewDataSetWriterId", "callNewDataSetWriterId"},
		{"receive", other + "/Pub/Health/" + src, "otherPubHealthSource"},
		{"send", other + "/Get/Profile", "otherGetProfile"},
		{"send", other + "/Get/Profile/" + src, ""},
		{"send", other + "/Set/Config", ""},
		{"send", other + "/Del/SubscriptionList", ""},
		{"send", other + "/Call/NewDataSetWriterId", ""},
		{"send", other + "/Get/Data", ""},
		{"receive", other + "/Pub/Data", ""},
		{"send", "Oi4v2/Foo/" + Topic("acme.com/X/Y/1") + "/Get/MAM", ""},
		{"send", "Oi4v2/Registry/" + Topic("acme.com/X/Y/1") + "/Pub/MAM", ""},
	} {
		if got := api.Channel(c.action, c.topic); got != c.want {
			t.Errorf("%s %s: %q, want %q", c.action, c.topic, got, c.want)
		}
	}
	for _, c := range []struct{ filter, want string }{
		{"Oi4v2/+/+/Pub/MAM/#", "otherPubMam"},
		{"Oi4v2/+/+/Pub/SubscriptionList/#", "otherPubSubscriptionList"},
		{own + "/Get/MAM/#", "getMam"},
		{own + "/Call/NewDataSetWriterId/+", "callNewDataSetWriterIdSource"},
		{"Oi4v2/Utility/" + Topic("acme.com/X/Y/1") + "/Pub/Event/+/Status/+", "otherPubEventSourceFilter"},
		{"Oi4v2/+/+/Pub/Data/#", ""},
		{"Oi4v2/+/+/Set/Config/#", ""},
		{"#", ""},
	} {
		if got := api.Subscribed(c.filter); got != c.want {
			t.Errorf("%s: %q, want %q", c.filter, got, c.want)
		}
	}
}
