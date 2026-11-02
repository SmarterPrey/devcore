import { App } from 'aws-cdk-lib';
import { KiroUsageLoggingStack } from '../lib/stack';

const app = new App();
// `-c stage=dev` deploys a separate dev- prefixed stack. Anything else is prod.
const prefix = app.node.tryGetContext('stage') === 'dev' ? 'dev-' : '';
new KiroUsageLoggingStack(app, `${prefix}KiroUsageLoggingStack`, { prefix });
