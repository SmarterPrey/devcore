import { App } from 'aws-cdk-lib';
import { GithubMcpServerStack } from './stack';

const app = new App();
// `-c stage=dev` deploys a separate stack with dev- / dev_ prefixed names alongside prod.
const dev = app.node.tryGetContext('stage') === 'dev';

const context = (key: string) => app.node.tryGetContext(key) as string | undefined;

// `-c jwtDiscoveryUrl=... -c jwtAllowedClients=id1,id2` switches the runtime from IAM to JWT auth. The deploy
// workflow reads both from the KiroAgentGatewayStack outputs; omit them to keep IAM (SigV4).
const discoveryUrl = context('jwtDiscoveryUrl');
const allowedClients = (context('jwtAllowedClients') ?? '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

new GithubMcpServerStack(app, `${dev ? 'dev-' : ''}GithubMcpServerStack`, {
  runtimeNamePrefix: dev ? 'dev_' : '',
  jwtAuthorizer: discoveryUrl && allowedClients.length ? { discoveryUrl, allowedClients } : undefined,
  // `-c readOnly=true` removes every write tool; `-c toolsets=repos,issues` limits which toolsets exist.
  readOnly: String(context('readOnly')) === 'true',
  toolsets: context('toolsets'),
});
