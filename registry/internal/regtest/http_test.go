package regtest

import (
	"io"
	"net"
	"strings"
	"testing"
)

// TestRawEarlyAnswer: a server that answers a request before it has read
// all of it (431 for a large header, as hyper does) and closes the
// connection resets it; Raw still returns the status line of the answer
// instead of failing on the write (C-112 addendum 8, a hosted gate run).
func TestRawEarlyAnswer(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	const answer = "HTTP/1.1 431 Request Header Fields Too Large"
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		_, _ = io.ReadFull(c, make([]byte, 64))
		_, _ = io.WriteString(c, answer+"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
		c.Close()
	}()
	w := &Web{Addr: l.Addr().String()}
	request := "GET / HTTP/1.1\r\nHost: " + w.Addr + "\r\nX-Big: " + strings.Repeat("a", 16<<20) + "\r\n\r\n"
	if got := w.Raw(t, request); got != answer {
		t.Errorf("Raw: %q, want %q", got, answer)
	}
}
