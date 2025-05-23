import { BaseLogDriverProps } from './base-log-driver';
import { Duration, SecretValue, Token, UnscopedValidationError } from '../../../core';
import { TaskDefinition } from '../base/task-definition';
import { Secret } from '../container-definition';
import { CfnTaskDefinition } from '../ecs.generated';

/**
 * Remove undefined values from a dictionary
 */
export function removeEmpty<T>(x: { [key: string]: (T | undefined | string) }): { [key: string]: string } {
  for (const key of Object.keys(x)) {
    if (x[key] === undefined) {
      delete x[key];
    }
  }
  return x as any;
}

/**
 * Checks that a value is a positive integer
 */
export function ensurePositiveInteger(val: number) {
  if (!Token.isUnresolved(val) && Number.isInteger(val) && val < 0) {
    throw new UnscopedValidationError(`\`${val}\` must be a positive integer.`);
  }
}

/**
 * Checks that a value is contained in a range of two other values
 */
export function ensureInRange(val: number, start: number, end: number) {
  if (!Token.isUnresolved(val) && !(val >= start && val <= end)) {
    throw new UnscopedValidationError(`\`${val}\` must be within range ${start}:${end}`);
  }
}

export function stringifyOptions(options: { [key: string]: (SecretValue | Duration | string | string[] | number | boolean | undefined) }) {
  const _options: { [key: string]: string } = {};
  const filteredOptions = removeEmpty(options);

  for (const [key, value] of Object.entries(filteredOptions)) {
    // Convert value to string
    _options[key] = SecretValue.isSecretValue(value) ? value.unsafeUnwrap() : `${value}`;
  }

  return _options;
}

export function renderCommonLogDriverOptions(opts: BaseLogDriverProps) {
  return {
    'tag': opts.tag,
    'labels': joinWithCommas(opts.labels),
    'env': joinWithCommas(opts.env),
    'env-regex': opts.envRegex,
  };
}

export function joinWithCommas(xs?: string[]): string | undefined {
  return xs && xs.join(',');
}

export function renderLogDriverSecretOptions(secretValue: { [key: string]: Secret }, taskDefinition: TaskDefinition):
CfnTaskDefinition.SecretProperty[] {
  const secrets = [];
  for (const [name, secret] of Object.entries(secretValue)) {
    secret.grantRead(taskDefinition.obtainExecutionRole());
    secrets.push({
      name,
      valueFrom: secret.arn,
    });
  }
  return secrets;
}
