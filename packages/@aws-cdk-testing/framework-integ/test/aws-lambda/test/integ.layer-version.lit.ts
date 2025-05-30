import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { STANDARD_NODEJS_RUNTIME } from '../../config';

const app = new cdk.App({
  postCliContext: {
    '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false,
  },
});

const stack = new cdk.Stack(app, 'aws-cdk-layer-version-1');

// Just for the example - granting to the current account is not necessary.
const awsAccountId = stack.account;

/// !show
const layer = new lambda.LayerVersion(stack, 'MyLayer', {
  code: lambda.Code.fromAsset(path.join(__dirname, 'layer-code'), { exclude: ['*.ts'] }),
  compatibleRuntimes: [STANDARD_NODEJS_RUNTIME],
  license: 'Apache-2.0',
  description: 'A layer to test the L2 construct',
});

// To grant usage by other AWS accounts
layer.addPermission('remote-account-grant', { accountId: awsAccountId });

// To grant usage to all accounts in some AWS Ogranization
// layer.grantUsage({ accountId: '*', organizationId });

new lambda.Function(stack, 'MyLayeredLambda', {
  code: new lambda.InlineCode('foo'),
  handler: 'index.handler',
  runtime: STANDARD_NODEJS_RUNTIME,
  layers: [layer],
});
/// !hide

app.synth();
