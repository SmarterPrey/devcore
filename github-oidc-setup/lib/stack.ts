import { CfnOutput, Stack, StackProps, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface GithubOidcStackProps extends StackProps {
  readonly repo: string; // owner/name
  // Prefix of the OIDC `sub` claim, up to ":environment:". Must match the repo's OIDC subject setting
  // (gh api repos/<repo>/actions/oidc/customization/sub); defaults to the classic "repo:<repo>".
  readonly subjectPrefix?: string;
}

// GitHub environment -> variable values. A role trusts exactly one environment, so a run from the dev
// branch (environment "dev") can never assume a production role.
const ENVIRONMENTS = [
  { name: 'production', prefix: '' },
  { name: 'dev', prefix: 'dev-' },
];

// One role per workflow. Each deploys through the CDK bootstrap roles, so they hold no resource
// permissions of their own beyond what's listed in `extra`.
const WORKFLOWS: { id: string; variable: string; cdk: boolean; extra?: (prefix: string) => iam.PolicyStatement[] }[] = [
  { id: 'registries', variable: 'REGISTRIES_DEPLOY_ROLE_ARN', cdk: true },
  { id: 'skills', variable: 'SKILLS_DEPLOY_ROLE_ARN', cdk: true },
  {
    id: 'agents',
    variable: 'AGENTS_DEPLOY_ROLE_ARN',
    cdk: true,
    // Authenticated pulls from public.ecr.aws (anonymous pulls from CI hit 429s).
    extra: () => [
      new iam.PolicyStatement({ actions: ['ecr-public:GetAuthorizationToken', 'sts:GetServiceBearerToken'], resources: ['*'] }),
    ],
  },
  { id: 'quick-config', variable: 'QUICK_CONFIG_DEPLOY_ROLE_ARN', cdk: true },
  {
    id: 'kiro-config',
    variable: 'KIRO_CONFIG_DEPLOY_ROLE_ARN',
    cdk: true,
    extra: (prefix) => [
      bucketAccess(`${prefix}kiroenterpriseconfigstack-configbucket*`, ['s3:PutObject']),
      new iam.PolicyStatement({ actions: ['cloudfront:CreateInvalidation'], resources: ['*'] }),
    ],
  },
  // Deploys the Kiro usage-logging bucket and bucket policy purely through CDK (bootstrap roles),
  // so it needs no resource permissions of its own.
  { id: 'usage-logging', variable: 'USAGE_LOGGING_DEPLOY_ROLE_ARN', cdk: true },
  {
    id: 'content-sync',
    variable: 'CONTENT_SYNC_ROLE_ARN',
    cdk: false,
    extra: (prefix) => [bucketAccess(`${prefix}devopscontentmcpstack-contentbucket*`, ['s3:PutObject', 's3:DeleteObject'])],
  },
];

// CloudFormation names bucket "<lowercased stack name>-<logical id><hash>".
function bucketAccess(bucketPattern: string, objectActions: string[]) {
  return new iam.PolicyStatement({
    actions: [...objectActions, 's3:ListBucket'],
    resources: [`arn:aws:s3:::${bucketPattern}`, `arn:aws:s3:::${bucketPattern}/*`],
  });
}

export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GithubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    for (const env of ENVIRONMENTS) {
      for (const wf of WORKFLOWS) {
        const role = new iam.Role(this, `${env.name}-${wf.id}`, {
          roleName: `github-${env.prefix}${wf.id}`,
          assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub': `${props.subjectPrefix ?? `repo:${props.repo}`}:environment:${env.name}`,
            },
          }),
        });

        role.addToPolicy(new iam.PolicyStatement({ actions: ['cloudformation:DescribeStacks'], resources: ['*'] }));
        if (wf.cdk) {
          role.addToPolicy(
            new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*-role-${this.account}-*`],
            }),
          );
        }
        for (const s of wf.extra?.(env.prefix) ?? []) role.addToPolicy(s);

        new CfnOutput(this, `${env.name}-${wf.id}-arn`, {
          description: `${env.name} environment variable ${wf.variable}`,
          value: role.roleArn,
        });
      }
    }
  }
}
