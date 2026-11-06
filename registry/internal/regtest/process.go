package regtest

import (
	"bufio"
	"bytes"
	"errors"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"testing"
	"time"
)

// Process is the registry running for a test: its standard output is
// collected line by line, its standard error kept for the log.
type Process struct {
	cmd    *exec.Cmd
	out    *lines[string]
	errMu  sync.Mutex
	stderr bytes.Buffer
	exited chan struct{}
	err    error
}

type lockedWriter struct {
	mu *sync.Mutex
	b  *bytes.Buffer
}

func (w lockedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.Write(p)
}

// Start runs exe with the environment of the test plus env; it is killed
// at the end of t if still running, and its standard error is logged if t
// failed.
func Start(t *testing.T, exe string, env ...string) *Process {
	t.Helper()
	p := &Process{cmd: exec.Command(exe), exited: make(chan struct{})}
	p.cmd.Env = append(os.Environ(), env...)
	p.cmd.Stderr = lockedWriter{&p.errMu, &p.stderr}
	stdout, err := p.cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := p.cmd.Start(); err != nil {
		t.Fatal(err)
	}
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 1<<20), 1<<24)
	p.out = readLines(scan, func(b []byte) string { return string(b) })
	go func() {
		<-p.out.done
		p.err = p.cmd.Wait()
		close(p.exited)
	}()
	t.Cleanup(func() {
		select {
		case <-p.exited:
		default:
			_ = p.cmd.Process.Kill()
			<-p.exited
		}
		if t.Failed() {
			t.Logf("%s stderr:\n%s", exe, p.Stderr())
		}
	})
	return p
}

// Line waits for a line of standard output from index from on that
// matches; it fails t after Wait.
func (p *Process) Line(t *testing.T, from int, what string, match func(string) bool) (string, int) {
	t.Helper()
	return p.out.expect(t, from, "output line: "+what, match)
}

// Lines is a copy of the output lines so far.
func (p *Process) Lines() []string { return p.out.all() }

// Len is the number of output lines so far.
func (p *Process) Len() int { return p.out.len() }

// Stderr is the standard error so far.
func (p *Process) Stderr() string {
	p.errMu.Lock()
	defer p.errMu.Unlock()
	return p.stderr.String()
}

// Exit waits for the exit without a signal; it returns the exit error
// (nil for status 0) and fails t after Wait.
func (p *Process) Exit(t *testing.T) error {
	t.Helper()
	select {
	case <-p.exited:
		return p.err
	case <-time.After(Wait):
		t.Fatalf("no exit within %v", Wait)
		return nil
	}
}

// Stop sends SIGTERM and waits for the exit; it returns the exit error
// (nil for status 0) and fails t after Wait.
func (p *Process) Stop(t *testing.T) error {
	t.Helper()
	if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
		t.Fatal(err)
	}
	select {
	case <-p.exited:
		return p.err
	case <-time.After(Wait):
		t.Fatalf("no exit within %v after SIGTERM", Wait)
		return nil
	}
}
