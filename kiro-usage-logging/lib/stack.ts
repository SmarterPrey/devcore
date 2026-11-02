import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps, aws_iam as iam, aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface KiroUsageLoggingStackProps extends StackProps {
  // "dev-" in the dev stage; prefixes the stack name and the log key prefixes.
  readonly prefix: string;
  // How long to keep log objects before S3 expires them. 0 keeps them forever.
  readonly retentionDays?: number;
}

// Destination bucket for Kiro's enterprise usage logging. Kiro (through its Amazon Q Developer backend)
// delivers two kinds of data here, both into a bucket in this account:
//
//   - Prompt logging: user prompts and Kiro's responses from the IDE and CLI, under
//     <promptPrefix>/AWSLogs/<accountId>/QDeveloperLogs/<log-type>/<region>/...
//   - Per-user activity reports: daily aggregate CSV telemetry, under
//     <promptPrefix>/AWSLogs/<accountId>/KiroLogs/user_report/<region>/...
//
// This stack only provisions the destination and the write permission. Turning either feature on is a
// manual console step with no API: Kiro settings > enterprise monitoring, set the bucket to the
// LogBucketName output and use the promptPrefix for both features. Prompt logging can only be enabled
// from a standalone or management account; it is not supported for member accounts in an AWS Organization.
//
// Bucket policy derived from the Amazon Q Developer prompt-logging docs: principal q.amazonaws.com,
// s3:PutObject, scoped by aws:SourceAccount (this account) and an aws:SourceArn on the codewhisperer
// service ARN so only this account's Q/Kiro backend can write.
export class KiroUsageLoggingStack extends Stack {
  constructor(scope: Construct, id: string, props: KiroUsageLoggingStackProps) {
    super(scope, id, props);

    const retentionDays = props.retentionDays ?? 365;
    const promptPrefix = `${props.prefix}prompt-logs`;

    const bucket = new s3.Bucket(this, 'LogBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules:
        retentionDays > 0
          ? [{ expiration: Duration.days(retentionDays), noncurrentVersionExpiration: Duration.days(retentionDays) }]
          : undefined,
    });

    // Only this account's Q/Kiro backend may write, and only under the two documented key spaces.
    const writeConditions = {
      StringEquals: { 'aws:SourceAccount': this.account },
      ArnLike: { 'aws:SourceArn': `arn:${this.partition}:codewhisperer:${this.region}:${this.account}:*` },
    };

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'QDeveloperPromptLogsWrite',
        principals: [new iam.ServicePrincipal('q.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [bucket.arnForObjects(`${promptPrefix}/*`)],
        conditions: writeConditions,
      }),
    );

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'KiroUserReportWrite',
        principals: [new iam.ServicePrincipal('q.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [bucket.arnForObjects(`${promptPrefix}/AWSLogs/${this.account}/KiroLogs/*`)],
        conditions: writeConditions,
      }),
    );

    new CfnOutput(this, 'LogBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'LogBucketArn', { value: bucket.bucketArn });
    // Paste this prefix into the Kiro console when enabling prompt logging.
    new CfnOutput(this, 'PromptLogPrefix', { value: promptPrefix });
    // Where per-user daily reports land once user-activity export is enabled.
    new CfnOutput(this, 'UserReportPath', {
      value: `s3://${bucket.bucketName}/${promptPrefix}/AWSLogs/${this.account}/KiroLogs/user_report/${this.region}/`,
    });
  }
}
