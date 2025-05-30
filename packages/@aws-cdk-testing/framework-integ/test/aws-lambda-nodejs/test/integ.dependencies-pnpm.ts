import * as path from 'path';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { ExpectedResult, IntegTest } from '@aws-cdk/integ-tests-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';

const app = new cdk.App({
  postCliContext: {
    '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false,
  },
});

const stack = new cdk.Stack(app, 'TestStack');

const handler = new lambda.NodejsFunction(stack, 'Function', {
  entry: path.join(__dirname, 'integ-handlers/pnpm/dependencies-pnpm.ts'),
  runtime: Runtime.NODEJS_18_X,
  bundling: {
    minify: true,
    // Will be installed, not bundled
    // (axios is a package with sub-dependencies,
    // will be used to ensure pnpm bundling works as expected)
    nodeModules: ['axios'],
    forceDockerBundling: true,
  },
  depsLockFilePath: path.join(__dirname, 'integ-handlers/pnpm/pnpm-lock.yaml'),
});

const integ = new IntegTest(app, 'PnpmTest', {
  testCases: [stack],
  stackUpdateWorkflow: false, // this will tell the runner to not check in assets.
});

const response = integ.assertions.invokeFunction({
  functionName: handler.functionName,
});
response.expect(ExpectedResult.objectLike({
  // expect invoking without error
  StatusCode: 200,
  ExecutedVersion: '$LATEST',
  Payload: 'null',
}));
