package regtest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// channel is a channel of the AsyncAPI document of the registry: its
// address as a regular expression and the actions of its operations.
type channel struct {
	name    string
	address *regexp.Regexp
	actions map[string]bool
}

// API is the AsyncAPI document of the registry (registry/api/asyncapi.json,
// ADR-0029 §8), read for the topics of the registry identified by il.
type API struct {
	channels []channel
}

// LoadAPI reads registry/api/asyncapi.json: every address becomes a regular
// expression – {appId} the topic level of il, {filter} one or more levels
// (a Filter may have several, MG 4.3), {serviceType} one of its enum, every
// other parameter one level.
func LoadAPI(t *testing.T, il string) *API {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(Oec(), "registry", "api", "asyncapi.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Channels map[string]struct {
			Address    string `json:"address"`
			Parameters map[string]struct {
				Enum []string `json:"enum"`
			} `json:"parameters"`
		} `json:"channels"`
		Operations map[string]struct {
			Action  string `json:"action"`
			Channel struct {
				Ref string `json:"$ref"`
			} `json:"channel"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	actions := map[string]map[string]bool{}
	for _, op := range doc.Operations {
		ch := strings.TrimPrefix(op.Channel.Ref, "#/channels/")
		if actions[ch] == nil {
			actions[ch] = map[string]bool{}
		}
		actions[ch][op.Action] = true
	}
	api := &API{}
	for name, ch := range doc.Channels {
		var re strings.Builder
		re.WriteString("^")
		for i, level := range strings.Split(ch.Address, "/") {
			if i > 0 {
				re.WriteString("/")
			}
			param, ok := strings.CutPrefix(level, "{")
			if !ok {
				re.WriteString(regexp.QuoteMeta(level))
				continue
			}
			param = strings.TrimSuffix(param, "}")
			switch {
			case param == "appId":
				re.WriteString(regexp.QuoteMeta(Topic(il)))
			case param == "filter":
				re.WriteString(".+")
			case len(ch.Parameters[param].Enum) > 0:
				quoted := make([]string, 0, len(ch.Parameters[param].Enum))
				for _, v := range ch.Parameters[param].Enum {
					quoted = append(quoted, regexp.QuoteMeta(v))
				}
				re.WriteString("(?:" + strings.Join(quoted, "|") + ")")
			default:
				re.WriteString("[^/]+")
			}
		}
		re.WriteString("$")
		api.channels = append(api.channels, channel{name, regexp.MustCompile(re.String()), actions[name]})
	}
	return api
}

// Channel is the name of a channel of the document with an operation of the
// action ("send", "receive") whose address matches topic, "" if none.
func (a *API) Channel(action, topic string) string {
	for _, ch := range a.channels {
		if ch.actions[action] && ch.address.MatchString(topic) {
			return ch.name
		}
	}
	return ""
}

// Subscribed is the name of a receive channel a subscription filter covers,
// "" if none: + stands for a value of the level (a ServiceType at level 1),
// # for zero to three further levels.
func (a *API) Subscribed(filter string) string {
	levels := strings.Split(filter, "/")
	for i, l := range levels {
		if l == "+" {
			levels[i] = "x"
			if i == 1 {
				levels[i] = "Utility"
			}
		}
	}
	topic := strings.Join(levels, "/")
	prefix, multi := strings.CutSuffix(topic, "/#")
	if !multi {
		return a.Channel("receive", topic)
	}
	for _, rest := range []string{"", "/x", "/x/x", "/x/x/x"} {
		if name := a.Channel("receive", prefix+rest); name != "" {
			return name
		}
	}
	return ""
}

// CheckWire fails t for every topic the connections conns published that is
// not a send channel of the document and every filter they subscribed to
// that covers no receive channel (ADR-0029 §8: the document is the
// interface); it returns the number of publications checked.
func CheckWire(t *testing.T, api *API, events []Seen, conns map[int]bool) int {
	t.Helper()
	n := 0
	for _, s := range events {
		if !conns[s.Conn] {
			continue
		}
		switch s.Seen {
		case "publish":
			n++
			if api.Channel("send", s.Topic) == "" {
				t.Errorf("the registry published on %s: no send channel of api/asyncapi.json", s.Topic)
			}
		case "subscribe":
			for _, f := range s.Filters {
				if api.Subscribed(f) == "" {
					t.Errorf("the registry subscribed to %s: no receive channel of api/asyncapi.json", f)
				}
			}
		}
	}
	return n
}
