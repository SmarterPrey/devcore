// Command agentcore-shim runs github-mcp-server behind a reverse proxy so it works on AgentCore Runtime.
//
// AgentCore uses the Authorization header for its own inbound auth (SigV4 or a JWT), so callers send their
// GitHub token in X-GitHub-Token and the shim moves it into Authorization. It also answers GET /ping, which
// the GitHub server would reject with 401.
//
// Usage: agentcore-shim <server command> [args...]
package main

import (
	"errors"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const (
	listenAddr   = "0.0.0.0:8000"
	upstreamAddr = "127.0.0.1:8082" // must match the server's --listen-host and --port
	tokenHeader  = "X-GitHub-Token"
)

func newHandler(upstream *url.URL) http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(upstream)
			token := strings.TrimSpace(r.In.Header.Get(tokenHeader))
			if len(token) > 7 && strings.EqualFold(token[:7], "Bearer ") {
				token = strings.TrimSpace(token[7:])
			}
			// Whatever arrived in Authorization belongs to AgentCore and is never passed on.
			r.Out.Header.Del("Authorization")
			r.Out.Header.Del(tokenHeader)
			if token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+token)
			}
		},
		FlushInterval: -1, // stream server-sent events as they arrive
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, _ *http.Request) {
		conn, err := net.DialTimeout("tcp", upstream.Host, time.Second)
		if err != nil {
			http.Error(w, "server not listening", http.StatusServiceUnavailable)
			return
		}
		_ = conn.Close()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"Healthy"}`))
	})
	mux.Handle("/", proxy)
	return mux
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: agentcore-shim <server command> [args...]")
	}

	child := exec.Command(os.Args[1], os.Args[2:]...)
	child.Stdout, child.Stderr = os.Stdout, os.Stderr
	if err := child.Start(); err != nil {
		log.Fatalf("start server: %v", err)
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		for s := range signals {
			_ = child.Process.Signal(s)
		}
	}()

	srv := &http.Server{
		Addr:              listenAddr,
		Handler:           newHandler(&url.URL{Scheme: "http", Host: upstreamAddr}),
		ReadHeaderTimeout: 60 * time.Second,
	}
	go func() {
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			_ = child.Process.Kill()
			log.Fatalf("listen: %v", err)
		}
	}()

	// The container's life follows the server's.
	err := child.Wait()
	_ = srv.Close()
	if err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
