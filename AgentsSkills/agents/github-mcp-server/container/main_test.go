package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestAuthorizationRewrite(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, r.URL.Path+"|"+r.Header.Get("Authorization")+"|"+r.Header.Get(tokenHeader))
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL)
	shim := httptest.NewServer(newHandler(u))
	defer shim.Close()

	for name, tc := range map[string]struct {
		headers map[string]string
		want    string
	}{
		"bare token":                  {map[string]string{tokenHeader: "ghp_abc"}, "/mcp|Bearer ghp_abc|"},
		"bearer prefix":               {map[string]string{tokenHeader: "bearer ghp_abc"}, "/mcp|Bearer ghp_abc|"},
		"replaces inbound auth":       {map[string]string{tokenHeader: "ghp_abc", "Authorization": "Bearer eyJ.jwt"}, "/mcp|Bearer ghp_abc|"},
		"never forwards inbound auth": {map[string]string{"Authorization": "Bearer eyJ.jwt"}, "/mcp||"},
		"no headers":                  {nil, "/mcp||"},
	} {
		t.Run(name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodPost, shim.URL+"/mcp", nil)
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			if string(body) != tc.want {
				t.Errorf("got %q, want %q", body, tc.want)
			}
		})
	}
}

func TestPing(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	u, _ := url.Parse(upstream.URL)
	handler := newHandler(u)

	ping := func() int {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ping", nil))
		return rec.Code
	}
	if got := ping(); got != http.StatusOK {
		t.Errorf("upstream up: got %d", got)
	}
	upstream.Close()
	if got := ping(); got != http.StatusServiceUnavailable {
		t.Errorf("upstream down: got %d", got)
	}
}
