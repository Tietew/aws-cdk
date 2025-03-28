import { Construct, Node } from 'constructs';
import { CfnRestApi } from './apigateway.generated';
import { IRestApi } from './restapi';
import * as s3 from '../../aws-s3';
import * as s3_assets from '../../aws-s3-assets';
import { UnscopedValidationError, ValidationError } from '../../core/lib/errors';
import * as cxapi from '../../cx-api';

/**
 * Represents an OpenAPI definition asset.
 */
export abstract class ApiDefinition {
  /**
   * Creates an API definition from a specification file in an S3 bucket
   */
  public static fromBucket(bucket: s3.IBucket, key: string, objectVersion?: string): S3ApiDefinition {
    return new S3ApiDefinition(bucket, key, objectVersion);
  }

  /**
   * Create an API definition from an inline object. The inline object must follow the
   * schema of OpenAPI 2.0 or OpenAPI 3.0
   *
   * @example
   *
   *   apigateway.ApiDefinition.fromInline({
   *     openapi: '3.0.2',
   *     paths: {
   *       '/pets': {
   *         get: {
   *           'responses': {
   *             200: {
   *               content: {
   *                 'application/json': {
   *                   schema: {
   *                     $ref: '#/components/schemas/Empty',
   *                   },
   *                 },
   *               },
   *             },
   *           },
   *           'x-amazon-apigateway-integration': {
   *             responses: {
   *               default: {
   *                 statusCode: '200',
   *               },
   *             },
   *             requestTemplates: {
   *               'application/json': '{"statusCode": 200}',
   *             },
   *             passthroughBehavior: 'when_no_match',
   *             type: 'mock',
   *           },
   *         },
   *       },
   *     },
   *     components: {
   *       schemas: {
   *         Empty: {
   *           title: 'Empty Schema',
   *           type: 'object',
   *         },
   *       },
   *     },
   *   });
   */
  public static fromInline(definition: any): InlineApiDefinition {
    return new InlineApiDefinition(definition);
  }

  /**
   * Loads the API specification from a local disk asset.
   */
  public static fromAsset(file: string, options?: s3_assets.AssetOptions): AssetApiDefinition {
    return new AssetApiDefinition(file, options);
  }

  /**
   * Called when the specification is initialized to allow this object to bind
   * to the stack, add resources and have fun.
   *
   * @param scope The binding scope. Don't be smart about trying to down-cast or
   * assume it's initialized. You may just use it as a construct scope.
   */
  public abstract bind(scope: Construct): ApiDefinitionConfig;

  /**
   * Called after the CFN RestApi resource has been created to allow the Api
   * Definition to bind to it. Specifically it's required to allow assets to add
   * metadata for tooling like SAM CLI to be able to find their origins.
   */
  public bindAfterCreate(_scope: Construct, _restApi: IRestApi) {
    return;
  }
}

/**
 * S3 location of the API definition file
 */
export interface ApiDefinitionS3Location {
  /** The S3 bucket */
  readonly bucket: string;
  /** The S3 key */
  readonly key: string;
  /**
   * An optional version
   * @default - latest version
   */
  readonly version?: string;
}

/**
 * Post-Binding Configuration for a CDK construct
 */
export interface ApiDefinitionConfig {
  /**
   * The location of the specification in S3 (mutually exclusive with `inlineDefinition`).
   *
   * @default - API definition is not an S3 location
   */
  readonly s3Location?: ApiDefinitionS3Location;

  /**
   * Inline specification (mutually exclusive with `s3Location`).
   *
   * @default - API definition is not defined inline
   */
  readonly inlineDefinition?: any;
}

/**
 * OpenAPI specification from an S3 archive.
 */
export class S3ApiDefinition extends ApiDefinition {
  private bucketName: string;

  constructor(bucket: s3.IBucket, private key: string, private objectVersion?: string) {
    super();

    if (!bucket.bucketName) {
      throw new ValidationError('bucketName is undefined for the provided bucket', bucket);
    }

    this.bucketName = bucket.bucketName;
  }

  public bind(_scope: Construct): ApiDefinitionConfig {
    return {
      s3Location: {
        bucket: this.bucketName,
        key: this.key,
        version: this.objectVersion,
      },
    };
  }
}

/**
 * OpenAPI specification from an inline JSON object.
 */
export class InlineApiDefinition extends ApiDefinition {
  constructor(private definition: any) {
    super();

    if (typeof(definition) !== 'object') {
      throw new UnscopedValidationError('definition should be of type object');
    }

    if (Object.keys(definition).length === 0) {
      throw new UnscopedValidationError('JSON definition cannot be empty');
    }
  }

  public bind(_scope: Construct): ApiDefinitionConfig {
    return {
      inlineDefinition: this.definition,
    };
  }
}

/**
 * OpenAPI specification from a local file.
 */
export class AssetApiDefinition extends ApiDefinition {
  private asset?: s3_assets.Asset;

  constructor(private readonly path: string, private readonly options: s3_assets.AssetOptions = { }) {
    super();
  }

  public bind(scope: Construct): ApiDefinitionConfig {
    // If the same AssetAPIDefinition is used multiple times, retain only the first instantiation.
    if (this.asset === undefined) {
      this.asset = new s3_assets.Asset(scope, 'APIDefinition', {
        path: this.path,
        ...this.options,
      });
    }

    if (this.asset.isZipArchive) {
      throw new ValidationError(`Asset cannot be a .zip file or a directory (${this.path})`, scope);
    }

    return {
      s3Location: {
        bucket: this.asset.s3BucketName,
        key: this.asset.s3ObjectKey,
      },
    };
  }

  public bindAfterCreate(scope: Construct, restApi: IRestApi) {
    if (!scope.node.tryGetContext(cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT)) {
      return; // not enabled
    }

    if (!this.asset) {
      throw new ValidationError('bindToResource() must be called after bind()', scope);
    }

    const child = Node.of(restApi).defaultChild as CfnRestApi;
    child.addMetadata(cxapi.ASSET_RESOURCE_METADATA_PATH_KEY, this.asset.assetPath);
    child.addMetadata(cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY, 'BodyS3Location');
  }
}
