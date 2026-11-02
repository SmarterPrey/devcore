# devcore

Monorepo for infrastructure stacks that deploy AI and developer services on AWS, including the AgentCore registries and MCP services used by Kiro and Amazon Quick. It holds the stacks and the supporting agents, skills, and team content in one repository so they are versioned together.

## Layout

| Directory | Contents | Owning team |
|---|---|---|
| [AgentRegistries](AgentRegistries) | CDK apps for the Kiro and Quick registries | `AgentRegistryDevs` |
| [AgentsSkills](AgentsSkills) | Agents (`agents/`, including the devops-content MCP server) and skills (`skills/`) | `AgentsSkillsDevs` |
| [quick-enterprise-configuration](quick-enterprise-configuration) | Customer-managed Quick service role limited to the Quick registry | `AgentRegistryDevs` |
| [kiro-enterprise-configuration](kiro-enterprise-configuration) | Kiro MCP allow-list and the CDN that serves it | `AgentRegistryDevs` |
| [kiro-usage-logging](kiro-usage-logging) | Destination S3 bucket and bucket policy for Kiro prompt logs and per-user activity reports | `AgentRegistryDevs` |
| [github-oidc-setup](github-oidc-setup) | GitHub OIDC provider and the workflow deploy roles (run once by an admin) | `AgentRegistryDevs` |
| [DevOps-Team-Content](DevOps-Team-Content) | Obsidian vault (Markdown notes) served by the devops-content MCP server | `DevOpsDevs` |

These began as separate repositories (`SmarterPrey/AgentRegistries`, `AgentsSkills`, `DevOps-Team-Content`) and were merged here with their history preserved. Those repositories are no longer the source of truth.

## How the pieces fit

```
DevOps-Team-Content  ──synced to S3──▶  AgentsSkills/agents/devops-content-mcp
                                          │ registered as a record in
                                          ▼
                      AgentRegistries/packages/kiro-agent-gateway   (CUSTOM_JWT, for Kiro)
                      AgentRegistries/packages/quick-agent-registry (AWS_IAM, for Amazon Quick)
                                          ▲
AgentsSkills  ──agents and skills published to──┘
```

- **Two registries** because consumers authenticate differently. Kiro connects through the registry's MCP endpoint with OAuth. Amazon Quick links one `AWS_IAM` registry in the same account and Region. `AuthorizerType` can't change after creation without replacing the registry.
- **`devops-content-mcp`** exposes the vault through three tools: `list_notes`, `read_note`, and `search_notes`. Deployed, it runs on AgentCore Runtime and reads notes from an S3 bucket; locally it reads `VAULT_DIR`.

## Getting started

```
git clone https://github.com/SmarterPrey/devcore.git
cd devcore/AgentRegistries
npm install
npm run build
npm run synth
```

## Deployment

Each part deploys on its own through GitHub Actions (`.github/workflows`), triggered by changes to its directory on `main` or run manually:

| Workflow | Deploys | Role variable |
|---|---|---|
| `deploy-registries.yml` | `AgentRegistries` stacks (Kiro and Quick as separate jobs) | `REGISTRIES_DEPLOY_ROLE_ARN` |
| `deploy-skills.yml` | `AgentsSkills/skills-publisher`, publishing `skills/*` as registry records | `SKILLS_DEPLOY_ROLE_ARN` |
| `deploy-agents.yml` | each changed `AgentsSkills/agents/*` CDK app | `AGENTS_DEPLOY_ROLE_ARN` |
| `deploy-quick-enterprise-config.yml` | `quick-enterprise-configuration` | `QUICK_CONFIG_DEPLOY_ROLE_ARN` |
| `publish-kiro-enterprise-config.yml` | `kiro-enterprise-configuration`, then uploads `mcp-registry.json` | `KIRO_CONFIG_DEPLOY_ROLE_ARN` |
| `deploy-kiro-usage-logging.yml` | `kiro-usage-logging` | `USAGE_LOGGING_DEPLOY_ROLE_ARN` |
| `sync-devops-content.yml` | `DevOps-Team-Content/**` Markdown to the devops-content S3 bucket | `CONTENT_SYNC_ROLE_ARN` |

### Dev stage

Pushes to `main` deploy prod. Pushes to a `dev` branch run the same workflows against a dev stage in the same account (`-c stage=dev`). Dev stacks and exports are prefixed `dev-` (`dev-KiroAgentGatewayStack`, `dev-AgentRegistries-KiroRegistryArn`). Names that only allow letters, digits and underscores use `dev_` instead (`dev_kiro_agent_gateway`, `dev_devops_content_mcp`). Dev has its own content bucket, which the sync workflow fills from the `dev` branch. Deploy it in the same order as prod. Run a workflow manually from `dev` to deploy dev; from any other branch it targets prod.

### Kiro registry sign-in (Cognito)

`KiroAgentGatewayStack` (`dev-` prefixed in dev) creates a Cognito user pool, a hosted sign-in domain, and a public app client (authorization code + PKCE). The registry's JWT authorizer accepts only access tokens issued to that client. Cognito can't do dynamic client registration, so each Kiro user is configured with the client ID rather than discovering it.

1. Deploy the stack and read its outputs: `RegistryMcpUrl`, `KiroClientId`, `SignInDomain`.
2. Add users: Cognito console > the `kiro-agent-gateway` pool > Users > Create user (self sign-up is off).
3. Point Kiro at the registry, using the client ID if your Kiro version supports a pre-registered OAuth client:

```json
{
  "mcpServers": {
    "agent-registry": {
      "type": "http",
      "url": "<RegistryMcpUrl>",
      "oauth": { "clientId": "<KiroClientId>", "callbackPort": 3334 }
    }
  }
}
```

If Kiro doesn't accept an `oauth` block, use the documented fallback: fetch an access token yourself and send it as `"headers": { "Authorization": "Bearer ${ACCESS_TOKEN}" }`.

The app client's callback URL defaults to `http://localhost:3334/oauth/callback`. Kiro's real callback isn't confirmed; if sign-in fails with a redirect mismatch, redeploy with `-c kiroOAuthCallbackUrls=<url>[,<url>]`.

The Quick registry is `AWS_IAM` and needs no sign-in setup.

### Enterprise configuration

Kiro and Quick enforce access differently, so there are two mechanisms:

- **Quick (IAM, enforced by AWS).** Quick links one `AWS_IAM` registry per account. `quick-enterprise-configuration` creates a customer-managed service role that can read only the Quick registry's records. Manual steps in the Quick admin console: choose this role as the account service role, then link `quick_agent_registry` under Manage account > Permissions > AWS Agent Registry. No API exists for either.
- **Kiro (allow-list, enforced by the client).** Kiro users sign in through the identity provider, so IAM doesn't apply to them. `mcp-registry.json` lists the MCP servers Kiro may use and is served over HTTPS. Manual step in the Kiro console: Settings > Q Developer tab, set MCP Registry URL to the stack's `AllowListUrl` output. Users can bypass client-side enforcement. `npm run validate` checks the file against the documented schema and that it covers every server in `AgentRegistries/shared/remote-mcp-servers.json`.

Neither blocks calls to other registries at the network level. An SCP denying `agent-registry:*` on other registries would, if the account is in AWS Organizations.

### Usage logging

`kiro-usage-logging` provisions the destination for Kiro's two enterprise usage-logging features and the bucket policy that lets Kiro write to it, nothing more. The bucket blocks public access, enforces TLS, is versioned, and expires objects after `retentionDays` (default 365; set `-c retentionDays=0` to keep forever). Its policy grants the `q.amazonaws.com` service principal `s3:PutObject`, scoped by `aws:SourceAccount` (this account) and an `aws:SourceArn` on the `codewhisperer` service ARN, so only this account's Kiro/Q Developer backend can write. Policy shape follows the [Amazon Q Developer prompt-logging docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-admin-prompt-logging.html).

Two features, both delivering into this one bucket:

- **Prompt logging** — user prompts and Kiro's responses from the IDE and CLI, under the `PromptLogPrefix` output (`prompt-logs`, `dev-prompt-logs` in dev). Sensitive: full prompts and code land in the bucket.
- **Per-user activity reports** — daily aggregate CSV telemetry, delivered to the `UserReportPath` output (`AWSLogs/<accountId>/KiroLogs/user_report/<region>/`).

Enabling either is a manual console step with no API (same as the allow-list): in the Kiro console under enterprise monitoring, turn the feature on and point it at the `LogBucketName` output (and `PromptLogPrefix` for prompt logging). Prompt logging can only be enabled from a standalone or management account; it is not supported for member accounts in an AWS Organization. If you enable SSE-KMS on the bucket, add the companion `kms:GenerateDataKey` grant for `q.amazonaws.com` documented in the same AWS page.

### AWS access for the workflows (GitHub OIDC)

The workflows sign in with short-lived GitHub OIDC tokens, so no AWS keys are stored in GitHub. `github-oidc-setup` creates the GitHub OIDC provider and 14 roles (7 workflows x `production`/`dev`). Each role trusts only `repo:SmarterPrey@135157929/devcore@1429268110:environment:<name>` (this repo's immutable OIDC subject; check yours with `gh api repos/SmarterPrey/devcore/actions/oidc/customization/sub` and override with `-c subjectPrefix=...`), so a dev run can't assume a production role. The roles deploy through the CDK bootstrap roles (`cdk-hnb659fds-*`), so they hold almost no permissions themselves; the content-sync and Kiro-config roles add scoped S3 access.

Run once, with an administrator session in the target account, in a Region where CDK is bootstrapped (us-east-1 here):

```
cd github-oidc-setup
npm install
npx cdk deploy                       # add -c repo=<owner>/<name> if the repo moves
```

Then create the two GitHub environments and set their variables from the stack outputs (`production-registries-arn` and so on). The role names are fixed (`github-<workflow>` for production, `github-dev-<workflow>` for dev), so the ARNs can be built from the account ID:

```
A=$(aws sts get-caller-identity --query Account --output text)
for env in production dev; do
  p=""; [ $env = dev ] && p="dev-"
  gh api -X PUT repos/SmarterPrey/devcore/environments/$env
  gh variable set AWS_REGION --env $env --body us-east-1
  for pair in REGISTRIES:registries SKILLS:skills AGENTS:agents QUICK_CONFIG:quick-config KIRO_CONFIG:kiro-config USAGE_LOGGING:usage-logging; do
    gh variable set ${pair%%:*}_DEPLOY_ROLE_ARN --env $env --body "arn:aws:iam::${A}:role/github-${p}${pair##*:}"
  done
  gh variable set CONTENT_SYNC_ROLE_ARN --env $env --body "arn:aws:iam::${A}:role/github-${p}content-sync"
done
```

Write `${A}` with braces: in zsh, `$A:role` is read as a history modifier and corrupts the ARN.

Protect the `production` environment (Settings > Environments): limit deployment branches to `main` and, if you want, require a reviewer. `dev` can be limited to the `dev` branch. Each GitHub environment name must match the role trust exactly.

### Setup

Create two GitHub environments, `production` and `dev`, and set `AWS_REGION` and the seven role variables in each (see above). The workflow picks the environment from the branch, so the variable names are the same in both. First-time order: registries, then the devops-content agent, then the content sync, then registries again (to add the devops-content record) and skills. The skills publisher imports the registry ARNs, and the registries read the agent's endpoint from its stack output.

## Working in this repo

Open a pull request against `main`. A change that spans directories lands as one commit.

## Ownership and review

There is no CODEOWNERS file. Anyone with write access can change any directory, and review is by convention: ask the owning team (see the Layout table) to review changes to their directory.

## Status

- The `dev` stage is deployed in us-east-1: `github-oidc-setup`, both registries, the skills publisher, the devops-content agent, and both enterprise configurations. Production is not deployed. The GitHub environments have no protection rules yet.
- Kiro connects to the Kiro registry.
- The `my-codereview` skill is published as a record in both registries, but Kiro can't connect to it yet.
- The devops-content MCP server is deployed and registered, with JWT auth from the Kiro registry's Cognito pool, but it hasn't been tested from Kiro.
- Two console steps have no API and stay manual: linking the registry and choosing the service role in Quick, and setting the allow-list URL in Kiro.
- `AgentsSkills/agents/example-agent` is a placeholder.
