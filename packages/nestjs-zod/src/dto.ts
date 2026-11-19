import { ApiExtraModels, ApiSchema, getSchemaPath } from '@nestjs/swagger';
import { z } from 'zod';
import type { $ZodType, JSONSchema } from 'zod/v4/core';

type Target = 'openapi-3.0' | 'draft-2020-12';

export interface ZodDto<TSchema extends $ZodType = $ZodType> {
  new (): z.output<TSchema>;
  readonly isZodDto: true;
  readonly schema: TSchema;
  readonly Output: ZodDto<TSchema>;
  create(input: unknown): z.output<TSchema>;
}

export function createZodDto<TSchema extends $ZodType>(
  schema: TSchema,
  { target = 'openapi-3.0' }: { target?: Target } = {},
): ZodDto<TSchema> {
  const outputModels = new WeakMap<object, ZodDto<TSchema>>();
  return createModel('input');

  function createModel(io: 'input' | 'output', name?: string): ZodDto<TSchema> {
    let openApi: ReturnType<typeof createOpenApiModel> | undefined;
    let conversionError: unknown;
    try {
      openApi = createOpenApiModel(schema, target, io);
    } catch (error) {
      conversionError = error;
    }

    const registered = new WeakSet<object>();
    class Dto {
      static readonly isZodDto = true;
      static readonly schema = schema;

      static create(input: unknown) {
        return z.parse(schema, input);
      }

      static get Output(): ZodDto<TSchema> {
        if (io === 'output') return this as unknown as ZodDto<TSchema>;
        let output = outputModels.get(this);
        if (!output) {
          output = createModel('output', this.name + '_Output');
          outputModels.set(this, output);
        }
        return output;
      }

      static _OPENAPI_METADATA_FACTORY() {
        if (!openApi) throw conversionError;
        const { model, componentName, resolveRefs } = openApi;
        if (model.type !== 'object') {
          throw new Error(
            'Automatic Swagger documentation requires an object DTO. Pass other roots as an explicit Swagger schema.',
          );
        }
        if (registered.has(this)) return {};
        const name = componentName ?? this.name;
        // Swagger 12 merges class schema metadata after its reflected properties.
        ApiSchema({ ...resolveRefs(model, name), name })(this);
        registered.add(this);
        return {};
      }
    }

    if (name) Object.defineProperty(Dto, 'name', { value: name });
    if (openApi?.components.length) ApiExtraModels(...openApi.components)(Dto);
    return Dto as unknown as ZodDto<TSchema>;
  }
}

let anonymousComponentSequence = 0;

function createOpenApiModel(
  schema: $ZodType,
  target: Target,
  io: 'input' | 'output',
) {
  const namedIds = new Set<string>();
  const {
    $schema: _dialect,
    $defs,
    definitions,
    ...inlineModel
  } = z.toJSONSchema(schema, {
    target,
    io,
    override({ zodSchema, jsonSchema }) {
      // Zod also emits these JSON Schema keywords for the OpenAPI 3.0 target.
      if (target === 'openapi-3.0') {
        delete jsonSchema.contentEncoding;
        delete jsonSchema.contentMediaType;
      }
      const id = z.globalRegistry.get(zodSchema)?.id;
      if (id) namedIds.add(id);
    },
  });

  const definitionsById = new Map(Object.entries($defs ?? definitions ?? {}));
  const id = z.globalRegistry.get(schema)?.id;
  const model = (id && definitionsById.get(id)) || inlineModel;
  const suffix = io === 'output' ? '_Output' : '';
  const names = new Map<string, string>();
  for (const key of definitionsById.keys()) {
    names.set(
      key,
      key === id || namedIds.has(key)
        ? key + suffix
        : '__ZodSchema_' + ++anonymousComponentSequence,
    );
  }

  let componentName = id ? id + suffix : undefined;
  const components = [];
  for (const [key, definition] of definitionsById) {
    if (key === id) continue;
    const name = names.get(key)!;
    class Component {}
    const options = {
      type: undefined,
      properties: undefined,
      ...resolveRefs(definition),
      name,
    };
    ApiSchema(options)(Component);
    components.push(Component);
  }

  return { model, componentName, components, resolveRefs };

  function resolveRefs(value: JSONSchema.BaseSchema, rootName?: string) {
    const result = structuredClone(value);
    visitSchemas(result, (node) => {
      const ref = node.$ref;
      if (typeof ref !== 'string') return;
      if (ref === '#') {
        const name =
          rootName ??
          (componentName ??= '__ZodSchema_' + ++anonymousComponentSequence);
        node.$ref = getSchemaPath(name);
        return;
      }
      const match = /^#\/(?:\$defs|definitions)\/([^/]+)(.*)$/.exec(ref);
      if (!match) return;
      const name = names.get(match[1].replace(/~1/g, '/').replace(/~0/g, '~'));
      if (name) node.$ref = getSchemaPath(name) + match[2];
    });
    return result;
  }
}

// Walk schema positions so examples and other metadata are left intact.
function visitSchemas(
  value: unknown,
  visit: (schema: Record<string, unknown>) => void,
) {
  if (!value || typeof value !== 'object') return;
  const schema = value as Record<string, unknown>;
  visit(schema);
  for (const key of ['properties', 'patternProperties', 'dependentSchemas']) {
    const children = schema[key];
    if (children && typeof children === 'object') {
      Object.values(children).forEach((child) => visitSchemas(child, visit));
    }
  }
  for (const key of [
    'items',
    'prefixItems',
    'additionalProperties',
    'propertyNames',
    'oneOf',
    'anyOf',
    'allOf',
    'not',
  ]) {
    const child = schema[key];
    if (Array.isArray(child)) {
      child.forEach((item) => visitSchemas(item, visit));
    } else {
      visitSchemas(child, visit);
    }
  }
}
