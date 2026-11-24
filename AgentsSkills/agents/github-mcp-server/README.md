# github-mcp-server

GitHub's official [github-mcp-server](https://github.com/github/github-mcp-server) in HTTP mode on Amazon Bedrock AgentCore Runtime, reached over the runtime's HTTPS endpoint.

## How it works

```
MCP client ──HTTPS──▶ AgentCore Runtime ──▶ agentcore-shim :8000 ──▶ github-mcp-server :8082 ──▶ api.github.com
  Authorization: AgentCore auth              X-GitHub-Token becomes Authorization
  X-GitHub-Token: your GitHub token
```

The image is the official one, pinned by digest, with one added binary (`container/main.go`). It is needed because:

- AgentCore uses `Authorization` for its own sign-in and forwards that header only when it holds the inbound JWT. The GitHub server reads its token from `Authorization` and rejects a JWT. The shim moves `X-GitHub-Token` into `Authorization` and drops whatever arrived there.
- AgentCore health-checks `GET /ping`, which the GitHub server answers with 401.

No GitHub credential is stored in AWS. Each caller sends their own token and can do only what that token allows, so prefer a fine-grained token limited to the repositories and permissions you need.

## Deploy

The `deploy-agents` workflow deploys this directory: `dev` pushes create `dev-GithubMcpServerStack`, `main` pushes create `GithubMcpServerStack`. By hand, with Docker running:

```
npm ci
npm run deploy -- -c stage=dev
```

| Context | Effect |
|---|---|
| `-c stage=dev` | `dev-` / `dev_` prefixed names |
| `-c jwtDiscoveryUrl=... -c jwtAllowedClients=...` | Cognito (JWT) sign-in instead of IAM SigV4. The workflow sets both from `KiroAgentGatewayStack` |
| `-c readOnly=true` | Removes every write tool. Off by default |
| `-c toolsets=repos,issues` | Limits the toolsets. The server's default set otherwise |

The workflow passes only the first two. To make the others permanent, put them in the `context` block of `cdk.json`.

`delete_repository` and the repository automation write tools stay disabled because no `GITHUB_MCP_SERVER_MRTR_STATE_KEY` is configured.

## Connect

The endpoint is the stack's `McpUrl` output. Every request needs both headers:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <Cognito access token>` (JWT sign-in), or a SigV4 signature (IAM) |
| `X-GitHub-Token` | A GitHub token (`ghp_`, `github_pat_`, `gho_`, `ghu_` or `ghs_`) |

With JWT sign-in, the access token comes from the Kiro registry's Cognito app client (see the root README).

## Upgrade

Update the tag and digest in `container/Dockerfile` together:

```
docker buildx imagetools inspect ghcr.io/github/github-mcp-server:<tag>
```
