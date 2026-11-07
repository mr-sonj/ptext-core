import type { OptionsSchema, ToolDefinition } from '../types.js';

/** TS type of one option value: enum members, string, boolean or number. */
type OptionValue<P> = P extends { enum: readonly (infer E)[] }
  ? E
  : P extends { type: 'boolean' }
    ? boolean
    : P extends { type: 'string' }
      ? string
      : number;

/** Names listed in `required` (inferred, so an absent `required` is never, not string). */
type RequiredNames<S> = S extends { required: readonly (infer R)[] } ? R : never;

/** Options that always have a value after validation: required ones and ones with a default. */
type PresentKeys<S extends OptionsSchema> = {
  [K in keyof S['properties']]: S['properties'][K] extends { default: unknown } ? K : K extends RequiredNames<S> ? K : never;
}[keyof S['properties']];

/** The validated options object a tool's `run` receives, derived from its JSON Schema. */
export type OptionsOf<S extends OptionsSchema> = {
  [K in PresentKeys<S>]: OptionValue<S['properties'][K]>;
} & {
  [K in Exclude<keyof S['properties'], PresentKeys<S>>]?: OptionValue<S['properties'][K]>;
};

/**
 * Declare a tool once: the options type of `run` is inferred from `options`,
 * so the schema and the code cannot drift apart.
 */
export function defineTool<const S extends OptionsSchema>(
  tool: Omit<ToolDefinition<OptionsOf<S>>, 'options'> & { options: S },
): ToolDefinition<OptionsOf<S>> {
  return tool;
}
