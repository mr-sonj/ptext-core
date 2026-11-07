import { PTextError, type OptionsSchema } from '../types.js';

/**
 * Validate raw options against a tool's schema. Applies defaults, coerces
 * string numbers/booleans (handy for CLI/query params) and rejects unknown keys.
 */
export function validateOptions(
  toolId: string,
  schema: OptionsSchema,
  raw: unknown,
): Record<string, unknown> {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PTextError('INVALID_OPTION', `Options for "${toolId}" must be an object`);
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    // hasOwn: `key in` would accept inherited names such as "constructor" and then ignore them.
    if (!Object.hasOwn(schema.properties, key)) {
      throw new PTextError('INVALID_OPTION', `Unknown option "${key}" for "${toolId}"`, {
        option: key,
        allowed: Object.keys(schema.properties),
      });
    }
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    let value = input[key];
    if (value === undefined) {
      if (schema.required?.includes(key)) {
        throw new PTextError('INVALID_OPTION', `Missing required option "${key}" for "${toolId}"`, { option: key });
      }
      if (prop.default !== undefined) out[key] = prop.default;
      continue;
    }

    const fail = (why: string): never => {
      throw new PTextError('INVALID_OPTION', `Option "${key}" for "${toolId}" ${why}`, { option: key });
    };

    switch (prop.type) {
      case 'boolean':
        if (value === 'true' || value === '1') value = true;
        else if (value === 'false' || value === '0') value = false;
        if (typeof value !== 'boolean') fail('must be a boolean');
        break;
      case 'integer':
      case 'number':
        if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) value = Number(value);
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(`must be a ${prop.type}`);
        if (prop.type === 'integer' && !Number.isInteger(value)) fail('must be an integer');
        if (prop.minimum !== undefined && (value as number) < prop.minimum) fail(`must be >= ${prop.minimum}`);
        if (prop.maximum !== undefined && (value as number) > prop.maximum) fail(`must be <= ${prop.maximum}`);
        break;
      case 'string':
        if (typeof value !== 'string') fail('must be a string');
        if (prop.minLength !== undefined && (value as string).length < prop.minLength) fail(`must be at least ${prop.minLength} characters`);
        if (prop.maxLength !== undefined && (value as string).length > prop.maxLength) fail(`must be at most ${prop.maxLength} characters`);
        break;
    }
    if (prop.enum && !prop.enum.includes(value as string | number)) {
      fail(`must be one of: ${prop.enum.join(', ')}`);
    }
    out[key] = value;
  }
  return out;
}
