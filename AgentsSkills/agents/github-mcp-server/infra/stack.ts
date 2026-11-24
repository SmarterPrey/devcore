import * as path from 'node:path';
import { CfnOutput, Fn, Stack, StackProps, aws_bedrockagentcore as agentcore, aws_ecr_assets as ecrAssets, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Hosts GitHub's official MCP server (HTTP mode) on AgentCore Runtime. The stack stores no GitHub
// credential: every caller sends their own token in X-GitHub-Token.
export interface GithubMcpServerStackProps extends StackProps {
  readonly runtimeNamePrefix?: string;
  // When set, callers authenticate with a JWT from this OIDC issuer (the Kiro registry's Cognito pool)
  // instead of SigV4, so Kiro can connect as an ordinary remote MCP server.
  readonly jwtAuthorizer?: {
    readonly discoveryUrl: string;
    readonly allowedClients: string[];
  };
  readonly readOnly?: boolean;
  readonly toolsets?: string; // comma separated; the server's default set when omitted
}

export class GithubMcpServerStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubMcpServerStackProps = {}) {
    super(scope, id, props);

    const image = new ecrAssets.DockerImageAsset(this, 'Image', {
      directory: path.join(__dirname, '..', 'container'),
      platform: ecrAssets.Platform.LINUX_ARM64,
    });

    const role = new iam.Role(this, 'RuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    });
    image.repository.grantPull(role);
    role.addToPolicy(new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
      }),
    );

    const runtime = new agentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: `${props.runtimeNamePrefix ?? ''}github_mcp_server`,
      description: 'GitHub official MCP server (HTTP mode)',
      protocolConfiguration: 'MCP',
      roleArn: role.roleArn,
      agentRuntimeArtifact: { containerConfiguration: { containerUri: image.imageUri } },
      // The server calls api.github.com, so it needs outbound internet access.
      networkConfiguration: { networkMode: 'PUBLIC' },
      environmentVariables: {
        ...(props.readOnly && { GITHUB_READ_ONLY: 'true' }),
        ...(props.toolsets && { GITHUB_TOOLSETS: props.toolsets }),
      },
      // AgentCore drops request headers unless they're listed here.
      requestHeaderConfiguration: { requestHeaderAllowlist: ['X-GitHub-Token'] },
      authorizerConfiguration: props.jwtAuthorizer && {
        customJwtAuthorizer: {
          discoveryUrl: props.jwtAuthorizer.discoveryUrl,
          allowedClients: props.jwtAuthorizer.allowedClients,
        },
      },
    });
    runtime.node.addDependency(role);

    // Without jwtAuthorizer the authorizer is IAM (SigV4): callers need bedrock-agentcore:InvokeAgentRuntime.
    // With it, callers send a Cognito access token as a bearer token and the runtime checks its client_id.
    const encodedArn = Fn.join('', [
      'arn%3Aaws%3Abedrock-agentcore%3A', this.region, '%3A', this.account, '%3Aruntime%2F', runtime.attrAgentRuntimeId,
    ]);
    new CfnOutput(this, 'RuntimeArn', { value: runtime.attrAgentRuntimeArn });
    new CfnOutput(this, 'McpUrl', {
      value: `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`,
    });
  }
}
