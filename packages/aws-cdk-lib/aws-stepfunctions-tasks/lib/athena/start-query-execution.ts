import { Construct } from 'constructs';
import * as iam from '../../../aws-iam';
import * as kms from '../../../aws-kms';
import * as s3 from '../../../aws-s3';
import * as sfn from '../../../aws-stepfunctions';
import * as cdk from '../../../core';
import { ValidationError } from '../../../core';
import { integrationResourceArn, validatePatternSupported } from '../private/task-utils';

interface AthenaStartQueryExecutionOptions {
  /**
   * Query that will be started
   */
  readonly queryString: string;

  /**
   * Unique string string to ensure idempotence
   *
   * @default - No client request token
   */
  readonly clientRequestToken?: string;

  /**
   * Database within which query executes
   *
   * @default - No query execution context
   */
  readonly queryExecutionContext?: QueryExecutionContext;

  /**
   * Configuration on how and where to save query
   *
   * @default - No result configuration
   */
  readonly resultConfiguration?: ResultConfiguration;

  /**
   * Configuration on how and where to save query
   *
   * @default - No work group
   */
  readonly workGroup?: string;

  /**
   * A list of values for the parameters in a query.
   *
   * The values are applied sequentially to the parameters in the query in the order
   * in which the parameters occur.
   *
   * @default - No parameters
   */
  readonly executionParameters?: string[];

  /**
   * Specifies, in minutes, the maximum age of a previous query result that Athena should consider for reuse.
   *
   * @default - Query results are not reused
   */
  readonly resultReuseConfigurationMaxAge?: cdk.Duration;
}

/**
 * Properties for starting a Query Execution using JSONPath
 */
export interface AthenaStartQueryExecutionJsonPathProps extends sfn.TaskStateJsonPathBaseProps, AthenaStartQueryExecutionOptions { }

/**
 * Properties for starting a Query Execution using JSONata
 */
export interface AthenaStartQueryExecutionJsonataProps extends sfn.TaskStateJsonataBaseProps, AthenaStartQueryExecutionOptions { }

/**
 * Properties for starting a Query Execution
 */
export interface AthenaStartQueryExecutionProps extends sfn.TaskStateBaseProps, AthenaStartQueryExecutionOptions { }

/**
 * Start an Athena Query as a Task
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/connect-athena.html
 */
export class AthenaStartQueryExecution extends sfn.TaskStateBase {
  /**
   * Start an Athena Query as a Task using JSONPath
   */
  public static jsonPath(scope: Construct, id: string, props: AthenaStartQueryExecutionJsonPathProps) {
    return new AthenaStartQueryExecution(scope, id, props);
  }

  /**
   * Start an Athena Query as a Task using JSONata
   */
  public static jsonata(scope: Construct, id: string, props: AthenaStartQueryExecutionJsonataProps) {
    return new AthenaStartQueryExecution(scope, id, { ...props, queryLanguage: sfn.QueryLanguage.JSONATA });
  }

  private static readonly SUPPORTED_INTEGRATION_PATTERNS: sfn.IntegrationPattern[] = [
    sfn.IntegrationPattern.REQUEST_RESPONSE,
    sfn.IntegrationPattern.RUN_JOB,
  ];

  protected readonly taskMetrics?: sfn.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];

  private readonly integrationPattern: sfn.IntegrationPattern;

  constructor(scope: Construct, id: string, private readonly props: AthenaStartQueryExecutionProps) {
    super(scope, id, props);
    this.integrationPattern = props.integrationPattern ?? sfn.IntegrationPattern.REQUEST_RESPONSE;

    validatePatternSupported(this.integrationPattern, AthenaStartQueryExecution.SUPPORTED_INTEGRATION_PATTERNS);
    this.validateExecutionParameters(props.executionParameters);
    this.validateMaxAgeInMinutes(props.resultReuseConfigurationMaxAge);

    this.taskPolicies = this.createPolicyStatements();
  }

  private validateExecutionParameters(executionParameters?: string[]) {
    if (executionParameters === undefined || cdk.Token.isUnresolved(executionParameters)) return;
    if (executionParameters.length == 0) {
      throw new ValidationError('\'executionParameters\' must be a non-empty list', this);
    }
    const invalidExecutionParameters = executionParameters.some(p => p.length < 1 || p.length > 1024);
    if (invalidExecutionParameters) {
      throw new ValidationError('\'executionParameters\' items\'s length must be between 1 and 1024 characters', this);
    }
  }

  private validateMaxAgeInMinutes(resultReuseConfigurationMaxAge?: cdk.Duration) {
    if (resultReuseConfigurationMaxAge === undefined || cdk.Token.isUnresolved(resultReuseConfigurationMaxAge)) return;
    const maxAgeInMillis = resultReuseConfigurationMaxAge.toMilliseconds();
    if (maxAgeInMillis > 0 && maxAgeInMillis < cdk.Duration.minutes(1).toMilliseconds()) {
      throw new ValidationError(`resultReuseConfigurationMaxAge must be greater than or equal to 1 minute or be equal to 0, got ${maxAgeInMillis} ms`, this);
    }
    const maxAgeInMinutes = resultReuseConfigurationMaxAge.toMinutes();
    if (maxAgeInMinutes > 10080) {
      throw new ValidationError(`resultReuseConfigurationMaxAge must either be 0 or between 1 and 10080 minutes, got ${maxAgeInMinutes}`, this);
    }
  }

  private createPolicyStatements(): iam.PolicyStatement[] {
    const policyStatements = [
      new iam.PolicyStatement({
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'athena',
            resource: 'datacatalog',
            resourceName: this.props.queryExecutionContext?.catalogName ?? 'AwsDataCatalog',
          }),
          cdk.Stack.of(this).formatArn({
            service: 'athena',
            resource: 'workgroup',
            resourceName: this.props.workGroup ?? 'primary',
          }),

        ],
        actions: ['athena:getDataCatalog', 'athena:startQueryExecution', 'athena:getQueryExecution'],
      }),
    ];

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['s3:CreateBucket',
          's3:ListBucket',
          's3:GetBucketLocation',
          's3:GetObject'],
        resources: ['*'], // Need * permissions to create new output location https://docs.aws.amazon.com/athena/latest/ug/security-iam-athena.html
      }),
    );

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['s3:AbortMultipartUpload',
          's3:ListBucketMultipartUploads',
          's3:ListMultipartUploadParts',
          's3:PutObject'],
        resources: [
          this.props.resultConfiguration?.outputLocation?.bucketName
            ? cdk.Stack.of(this).formatArn({
              // S3 Bucket names are globally unique in a partition,
              // and so their ARNs have empty region and account components
              region: '',
              account: '',
              service: 's3',
              resource: this.props.resultConfiguration?.outputLocation?.bucketName,
              resourceName: `${this.props.resultConfiguration?.outputLocation?.objectKey}/*`,
            })
            : '*',
        ],
      }),
    );

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['lakeformation:GetDataAccess'],
        resources: ['*'], // State machines scoped to output location fail and * permissions are required as per documentation https://docs.aws.amazon.com/lake-formation/latest/dg/permissions-reference.html
      }),
    );

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['glue:BatchCreatePartition',
          'glue:BatchDeletePartition',
          'glue:BatchDeleteTable',
          'glue:BatchGetPartition',
          'glue:CreateDatabase',
          'glue:CreatePartition',
          'glue:CreateTable',
          'glue:DeleteDatabase',
          'glue:DeletePartition',
          'glue:DeleteTable',
          'glue:GetDatabase',
          'glue:GetDatabases',
          'glue:GetPartition',
          'glue:GetPartitions',
          'glue:GetTable',
          'glue:GetTables',
          'glue:UpdateDatabase',
          'glue:UpdatePartition',
          'glue:UpdateTable'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'catalog',
          }),
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'database',
            resourceName: this.props.queryExecutionContext?.databaseName ?? 'default',
          }),
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'table',
            resourceName: (this.props.queryExecutionContext?.databaseName ?? 'default') + '/*', // grant access to all tables in the specified or default database to prevent cross database access https://docs.aws.amazon.com/IAM/latest/UserGuide/list_awsglue.html
          }),
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'userDefinedFunction',
            resourceName: (this.props.queryExecutionContext?.databaseName ?? 'default') + '/*', // grant access to get all user defined functions for the particular database in the request or the default database https://docs.aws.amazon.com/IAM/latest/UserGuide/list_awsglue.html
          }),
        ],
      }),
    );

    return policyStatements;
  }

  private renderEncryption(): any {
    const encryptionConfiguration = this.props.resultConfiguration?.encryptionConfiguration !== undefined
      ? {
        EncryptionOption: this.props.resultConfiguration.encryptionConfiguration.encryptionOption,
        KmsKey: this.props.resultConfiguration.encryptionConfiguration.encryptionKey,
      }
      : undefined;

    return encryptionConfiguration;
  }

  /**
   * Provides the Athena start query execution service integration task configuration
   */
  /**
   * @internal
   */
  protected _renderTask(topLevelQueryLanguage?: sfn.QueryLanguage): any {
    const queryLanguage = sfn._getActualQueryLanguage(topLevelQueryLanguage, this.props.queryLanguage);
    return {
      Resource: integrationResourceArn('athena', 'startQueryExecution', this.integrationPattern),
      ...this._renderParametersOrArguments({
        QueryString: this.props.queryString,
        ClientRequestToken: this.props.clientRequestToken,
        QueryExecutionContext: (this.props.queryExecutionContext?.catalogName || this.props.queryExecutionContext?.databaseName) ? {
          Catalog: this.props.queryExecutionContext?.catalogName,
          Database: this.props.queryExecutionContext?.databaseName,
        } : undefined,
        ResultConfiguration: {
          EncryptionConfiguration: this.renderEncryption(),
          OutputLocation: this.props.resultConfiguration?.outputLocation ? `s3://${this.props.resultConfiguration.outputLocation.bucketName}/${this.props.resultConfiguration.outputLocation.objectKey}/` : undefined,
        },
        WorkGroup: this.props.workGroup,
        ExecutionParameters: this.props.executionParameters,
        ResultReuseConfiguration: this.props.resultReuseConfigurationMaxAge ? {
          ResultReuseByAgeConfiguration: {
            Enabled: true,
            MaxAgeInMinutes: this.props.resultReuseConfigurationMaxAge.toMinutes(),
          },
        } : undefined,
      }, queryLanguage),
    };
  }
}

/**
 * Location of query result along with S3 bucket configuration
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_ResultConfiguration.html
 */
export interface ResultConfiguration {

  /**
   * S3 path of query results
   *
   * Example value: `s3://query-results-bucket/folder/`
   *
   * @default - Query Result Location set in Athena settings for this workgroup
   */
  readonly outputLocation?: s3.Location;

  /**
   * Encryption option used if enabled in S3
   *
   * @default - SSE_S3 encryption is enabled with default encryption key
   */
  readonly encryptionConfiguration?: EncryptionConfiguration;
}

/**
 * Encryption Configuration of the S3 bucket
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_EncryptionConfiguration.html
 */
export interface EncryptionConfiguration {

  /**
   * Type of S3 server-side encryption enabled
   *
   * @default EncryptionOption.S3_MANAGED
   */
  readonly encryptionOption: EncryptionOption;

  /**
   * KMS key ARN or ID
   *
   * @default - No KMS key for Encryption Option SSE_S3 and default master key for Encryption Option SSE_KMS and CSE_KMS
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Encryption Options of the S3 bucket
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_EncryptionConfiguration.html#athena-Type-EncryptionConfiguration-EncryptionOption
 */
export enum EncryptionOption {
  /**
   * Server side encryption (SSE) with an Amazon S3-managed key.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingServerSideEncryption.html
   */
  S3_MANAGED = 'SSE_S3',

  /**
   * Server-side encryption (SSE) with an AWS KMS key managed by the account owner.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingKMSEncryption.html
   */
  KMS = 'SSE_KMS',

  /**
   * Client-side encryption (CSE) with an AWS KMS key managed by the account owner.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingClientSideEncryption.html
   */
  CLIENT_SIDE_KMS = 'CSE_KMS',
}

/**
 * Database and data catalog context in which the query execution occurs
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_QueryExecutionContext.html
 */
export interface QueryExecutionContext {

  /**
   * Name of catalog used in query execution
   *
   * @default - No catalog
   */
  readonly catalogName?: string;

  /**
   * Name of database used in query execution
   *
   * @default - No database
   */
  readonly databaseName?: string;
}
