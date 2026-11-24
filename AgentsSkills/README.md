# AgentsSkills

Agents and skills published through the registries in AgentRegistries.

| Path | Purpose |
|---|---|
| `agents/` | One directory per agent. Any directory with a `cdk.json` is its own CDK app and deploys on its own |
| `agents/devops-content-mcp` | MCP server over the DevOps team content, hosted on AgentCore Runtime, reading notes from S3 |
| `agents/github-mcp-server` | GitHub's official MCP server in HTTP mode on AgentCore Runtime ([details](agents/github-mcp-server/README.md)) |
| `skills/` | One directory per skill (`SKILL.md`) |
| `skills-publisher/` | CDK app that publishes each skill as a `SKILL` record in both registries |

## devops-content-mcp

```
cd agents/devops-content-mcp
npm install
npm run build
npm run dev                                   # streamable HTTP on :8000/mcp, reads ../../../DevOps-Team-Content
node dist/server.js --stdio                   # stdio, for local clients
npm run synth                                 # DevopsContentMcpStack: bucket, image, AgentCore Runtime
```

`VAULT_DIR` points at a local vault. When `VAULT_BUCKET` (and optionally `VAULT_PREFIX`) is set, as it is on the deployed runtime, notes are read from S3 with a 60 second cache (`VAULT_CACHE_TTL_MS`). The runtime uses IAM (SigV4) auth, so callers need `bedrock-agentcore:InvokeAgentRuntime`.
