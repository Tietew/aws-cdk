import { Template } from 'aws-cdk-lib/assertions';
import { Stack } from 'aws-cdk-lib';
import { AssertionsProvider } from '../../../lib/assertions';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

let stack: Stack;
beforeEach(() => {
  stack = new Stack();
});

describe('AssertionProvider', () => {
  test('default', () => {
    // WHEN
    const provider = new AssertionsProvider(stack, 'AssertionProvider');

    // THEN
    expect(stack.resolve(provider.serviceToken)).toEqual({ 'Fn::GetAtt': ['SingletonFunction1488541a7b23466481b69b4408076b81HandlerCD40AE9F', 'Arn'] });
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Timeout: 120,
    });
  });

  test('default', () => {
    // WHEN
    const provider = new AssertionsProvider(stack, 'AssertionProvider', {
      logRetention: RetentionDays.ONE_WEEK,
    });

    // THEN
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Logs::LogGroup', 1);
    expect(stack.resolve(provider.serviceToken)).toEqual({ 'Fn::GetAtt': ['SingletonFunction1488541a7b23466481b69b4408076b81HandlerCD40AE9F', 'Arn'] });
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Timeout: 120,
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7,
    });
  });

  describe('addPolicyStatementForSdkCall', () => {
    test('default', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      provider.addPolicyStatementFromSdkCall('MyService', 'myApi');

      // THEN
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
        Policies: [
          {
            PolicyName: 'Inline',
            PolicyDocument: {
              Statement: [
                {
                  Action: ['myservice:MyApi'],
                  Resource: ['*'],
                  Effect: 'Allow',
                },
              ],
            },
          },
        ],
      });
    });

    test('multiple calls', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      provider.addPolicyStatementFromSdkCall('MyService', 'myApi');
      provider.addPolicyStatementFromSdkCall('MyService2', 'myApi2');

      // THEN
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
        Policies: [
          {
            PolicyName: 'Inline',
            PolicyDocument: {
              Statement: [
                {
                  Action: ['myservice:MyApi'],
                  Resource: ['*'],
                  Effect: 'Allow',
                },
                {
                  Action: ['myservice2:MyApi2'],
                  Resource: ['*'],
                  Effect: 'Allow',
                },
              ],
            },
          },
        ],
      });
    });

    test('multiple providers, 1 resource', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      const provider2 = new AssertionsProvider(stack, 'AssertionsProvider2');
      provider.addPolicyStatementFromSdkCall('MyService', 'myApi');
      provider2.addPolicyStatementFromSdkCall('MyService2', 'myApi2');

      // THEN
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
        Policies: [
          {
            PolicyName: 'Inline',
            PolicyDocument: {
              Statement: [
                {
                  Action: ['myservice:MyApi'],
                  Resource: ['*'],
                  Effect: 'Allow',
                },
                {
                  Action: ['myservice2:MyApi2'],
                  Resource: ['*'],
                  Effect: 'Allow',
                },
              ],
            },
          },
        ],
      });
    });

    test('prefix different from service name', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      provider.addPolicyStatementFromSdkCall('applicationautoscaling', 'myApi');

      // THEN
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
        Policies: [
          {
            PolicyName: 'Inline',
            PolicyDocument: {
              Statement: [
                {
                  Action: ['application-autoscaling:MyApi'],
                  Effect: 'Allow',
                  Resource: ['*'],
                },
              ],
            },
          },
        ],
      });
    });
  });

  describe('encode', () => {
    test('booleans', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      const encoded = provider.encode({
        Key1: true,
        Key2: false,
      });

      // THEN
      expect(encoded).toEqual({
        Key1: 'true',
        Key2: 'false',
      });
    });

    test('numbers', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      const encoded = provider.encode({
        Key1: 1,
        Key2: 2,
      });
      // THEN
      expect(encoded).toEqual({
        Key1: '1',
        Key2: '2',
      });
    });

    test('strings are double encoded', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');
      const encoded = provider.encode({
        Key1: 'foo',
        Key2: 'bar',
        Key3: ['hello', 'world'],
      });
      // THEN
      expect(encoded).toEqual({
        Key1: '"foo"',
        Key2: '"bar"',
        Key3: '["hello","world"]',
      });
    });

    test('nullish', () => {
      // WHEN
      const provider = new AssertionsProvider(stack, 'AssertionsProvider');

      // THEN
      expect(provider.encode(undefined)).toBeUndefined();
      expect(provider.encode(null)).toBeNull();
      expect(provider.encode({})).toEqual({});
    });
  });
});
