# Official github-mcp-server image plus a small front end that adapts it to AgentCore Runtime.
# The GitHub binary and its base image are used unchanged. To upgrade, change the tag and digest together
# (docker buildx imagetools inspect ghcr.io/github/github-mcp-server:<tag>).
ARG GITHUB_MCP_IMAGE=ghcr.io/github/github-mcp-server:v2.3.0@sha256:f8ee4dedc7d5c8cb32854ab91cc92a31c55a8a5510708cf8742e9f9427588ca6

# Cross-compiles on the build machine's own architecture, so CI needs no emulation for this stage.
FROM --platform=$BUILDPLATFORM public.ecr.aws/docker/library/golang:1.27.4-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS shim
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod *.go ./
RUN go vet ./... && go test ./...
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/agentcore-shim .

FROM ${GITHUB_MCP_IMAGE}
COPY --from=shim /out/agentcore-shim /server/agentcore-shim
USER 65532:65532
# AgentCore's MCP protocol expects 0.0.0.0:8000. The GitHub server listens on loopback only, behind the shim.
EXPOSE 8000
ENTRYPOINT ["/server/agentcore-shim"]
CMD ["/server/github-mcp-server", "http", "--listen-host", "127.0.0.1", "--port", "8082"]
