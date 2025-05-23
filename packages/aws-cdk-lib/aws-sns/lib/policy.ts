import { Construct } from 'constructs';
import { CfnTopicPolicy } from './sns.generated';
import { ITopic } from './topic-base';
import { Effect, PolicyDocument, PolicyStatement, StarPrincipal } from '../../aws-iam';
import { Resource } from '../../core';
import { addConstructMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/**
 * Properties to associate SNS topics with a policy
 */
export interface TopicPolicyProps {
  /**
   * The set of topics this policy applies to.
   */
  readonly topics: ITopic[];

  /**
   * IAM policy document to apply to topic(s).
   * @default empty policy document
   */
  readonly policyDocument?: PolicyDocument;

  /**
   * Adds a statement to enforce encryption of data in transit when publishing to the topic.
   *
   * For more information, see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit.
   *
   * @default false
   */
  readonly enforceSSL?: boolean;
}

/**
 * The policy for an SNS Topic
 *
 * Policies define the operations that are allowed on this resource.
 *
 * You almost never need to define this construct directly.
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * Prefer to use `addToResourcePolicy()` instead.
 */
@propertyInjectable
export class TopicPolicy extends Resource {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-sns.TopicPolicy';

  /**
   * The IAM policy document for this policy.
   */
  public readonly document = new PolicyDocument({
    // statements must be unique, so we use the statement index.
    // potantially SIDs can change as a result of order change, but this should
    // not have an impact on the policy evaluation.
    // https://docs.aws.amazon.com/sns/latest/dg/AccessPolicyLanguage_SpecialInfo.html
    assignSids: true,
  });

  constructor(scope: Construct, id: string, props: TopicPolicyProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    this.document = props.policyDocument ?? this.document;

    if (props.enforceSSL) {
      props.topics.map(t => this.document.addStatements(this.createSSLPolicyDocument(t.topicArn)));
    }

    new CfnTopicPolicy(this, 'Resource', {
      policyDocument: this.document,
      topics: props.topics.map(t => t.topicArn),
    });
  }

  /**
   * Adds a statement to enforce encryption of data in transit when publishing to the topic.
   *
   * For more information, see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit.
   */
  protected createSSLPolicyDocument(topicArn: string): PolicyStatement {
    return new PolicyStatement ({
      sid: 'AllowPublishThroughSSLOnly',
      actions: ['sns:Publish'],
      effect: Effect.DENY,
      resources: [topicArn],
      conditions: {
        Bool: { 'aws:SecureTransport': 'false' },
      },
      principals: [new StarPrincipal()],
    });
  }
}
