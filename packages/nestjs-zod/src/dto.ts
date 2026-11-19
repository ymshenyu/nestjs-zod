import { z } from 'zod';
import { globalRegistry, type $ZodType, type JSONSchema } from 'zod/v4/core';
import {
  DEFS_KEY,
  EMPTY_TYPE_KEY,
  PARENT_ADDITIONAL_PROPERTIES_KEY,
  PARENT_HAS_REFS_KEY,
  PARENT_ID_KEY,
  PARENT_METADATA_KEY,
  SELF_REQUIRED_KEY,
  TYPE_KEY,
  UNWRAP_ROOT_KEY,
} from './const';
import {
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  walkJsonSchema,
} from './utils';

export type OpenApiTarget = 'openapi-3.0' | 'draft-2020-12';

export interface ZodDto<TSchema extends $ZodType = $ZodType> {
  new (): z.output<TSchema>;
  readonly isZodDto: true;
  readonly schema: TSchema;
  readonly Output: ZodDto<TSchema>;
  create(input: unknown): z.output<TSchema>;
  _OPENAPI_METADATA_FACTORY(): Record<string, unknown>;
}

export function createZodDto<TSchema extends $ZodType>(
  schema: TSchema,
  { target = 'openapi-3.0' }: { target?: OpenApiTarget } = {},
): ZodDto<TSchema> {
  const outputModels = new WeakMap<object, ZodDto<TSchema>>();
  return createModel('input');

  function createModel(io: 'input' | 'output', name?: string): ZodDto<TSchema> {
    class AugmentedZodDto {
      public static readonly isZodDto = true;
      public static readonly schema = schema;

      public static create(input: unknown) {
        return z.parse(schema, input);
      }

      static get Output(): ZodDto<TSchema> {
        if (io === 'output') return this as unknown as ZodDto<TSchema>;
        let output = outputModels.get(this);
        if (!output) {
          output = createModel('output', `${this.name}_Output`);
          outputModels.set(this, output);
        }
        return output;
      }

      public static _OPENAPI_METADATA_FACTORY() {
        return openApiMetadataFactory({ schema, target, io });
      }
    }

    if (name) {
      Object.defineProperty(AugmentedZodDto, 'name', { value: name });
    }

    return AugmentedZodDto as unknown as ZodDto<TSchema>;
  }
}

export function isZodDto(metatype: unknown): metatype is ZodDto {
  return Boolean(
    metatype &&
    (typeof metatype === 'object' || typeof metatype === 'function') &&
    'isZodDto' in metatype &&
    metatype.isZodDto,
  );
}

const RESERVED_ROOT_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  '$defs',
  'definitions',
  'id',
]);

function openApiMetadataFactory({
  schema,
  target,
  io,
}: {
  schema: $ZodType;
  target: OpenApiTarget;
  io: 'input' | 'output';
}) {
  const { $defs, ...generatedJsonSchema } = generateJsonSchema(
    schema,
    target,
    io,
  );

  const zodId = globalRegistry.get(schema)?.id;
  const rootId = zodId && io === 'output' ? `${zodId}_Output` : zodId;

  const jsonSchema: JSONSchema.BaseSchema & {
    type: 'object';
    required?: string[];
    properties?: Record<string, JSONSchema.BaseSchema>;
    $defs?: Record<string, JSONSchema.BaseSchema>;
  } = !isObjectTypeWithProperties(generatedJsonSchema)
    ? {
        type: 'object' as const,
        title: generatedJsonSchema.title,
        properties: {
          root: {
            ...generatedJsonSchema,
            [UNWRAP_ROOT_KEY]: true,
          },
        },
        $defs,
      }
    : {
        ...generatedJsonSchema,
        $defs,
      };

  const hasRefs = schemaHasRefs(jsonSchema);

  const parentMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(jsonSchema)) {
    if (!RESERVED_ROOT_KEYS.has(key) && value !== undefined) {
      parentMetadata[key] = value;
    }
  }
  const hasParentMetadata = Object.keys(parentMetadata).length > 0;

  const properties: Record<string, unknown> = {};
  for (const [propertyKey, propertySchema] of Object.entries(
    jsonSchema.properties || {},
  )) {
    const hasStringType = typeof propertySchema.type === 'string';
    const hasCombinator =
      'allOf' in propertySchema ||
      'anyOf' in propertySchema ||
      'oneOf' in propertySchema;

    const newPropertySchema: Record<string, unknown> = {
      ...(propertySchema as Record<string, unknown>),
      // NestJS Swagger throws a spurious circular-dependency error when `type` is missing.
      type: hasStringType ? propertySchema.type : '',
    };

    // Stash array `type` (OpenAPI 3.1 `['string', 'null']`) and `type` alongside combinators
    // because @nestjs/swagger transforms array `type` into nested arrays and strips `type` on combinators.
    if (
      Array.isArray(propertySchema.type) ||
      (hasStringType && hasCombinator)
    ) {
      newPropertySchema[TYPE_KEY] = propertySchema.type;
    }

    if (!hasStringType) {
      newPropertySchema[EMPTY_TYPE_KEY] = true;
    }

    if (hasRefs) {
      newPropertySchema[PARENT_HAS_REFS_KEY] = true;
    }

    const required = Boolean(
      Array.isArray(jsonSchema.required) &&
      jsonSchema.required.includes(propertyKey),
    );
    if (newPropertySchema.type === 'object') {
      newPropertySchema.selfRequired = required;
      newPropertySchema[SELF_REQUIRED_KEY] = required;
    } else {
      newPropertySchema.required = required;
    }

    if (jsonSchema.$defs) {
      newPropertySchema[DEFS_KEY] = jsonSchema.$defs;
    }

    if (rootId) {
      newPropertySchema[PARENT_ID_KEY] = rootId;
    }

    if (typeof jsonSchema.additionalProperties === 'boolean') {
      newPropertySchema[PARENT_ADDITIONAL_PROPERTIES_KEY] =
        jsonSchema.additionalProperties;
    }

    if (hasParentMetadata) {
      newPropertySchema[PARENT_METADATA_KEY] = parentMetadata;
    }

    properties[propertyKey] = newPropertySchema;
  }

  return properties;
}

function generateJsonSchema(
  schema: $ZodType,
  target: OpenApiTarget,
  io: 'input' | 'output',
) {
  const {
    $schema: _dialect,
    $defs,
    definitions,
    ...root
  } = z.toJSONSchema(schema, {
    target,
    io,
    ...(target === 'openapi-3.0' && {
      override({ jsonSchema }) {
        // Zod also emits these JSON Schema keywords for the OpenAPI 3.0 target.
        delete jsonSchema.contentEncoding;
        delete jsonSchema.contentMediaType;
      },
    }),
  });

  const rawDefs = ($defs ?? definitions) as
    Record<string, JSONSchema.BaseSchema> | undefined;

  const newSchema = normalizeRefs(root, io);

  if (rawDefs) {
    const newDefs: Record<string, JSONSchema.BaseSchema> = {};
    for (const [defKey, defValue] of Object.entries(rawDefs)) {
      const newKey = io === 'output' ? `${defKey}_Output` : defKey;
      if (Object.hasOwn(newDefs, newKey)) {
        throw new Error(`[nestjs-zod] Duplicate id in $defs: ${newKey}`);
      }
      newDefs[newKey] = normalizeRefs(defValue, io);
    }
    newSchema.$defs = newDefs;
  }

  // Zod 4.5+ extracts a named root (`schema.meta({ id })`) into `$defs`/`definitions`
  // and leaves the root as `{ $ref: '#/$defs/<id>' }`. Splice it back as the root.
  const rootRef = newSchema.$ref;
  if (
    typeof rootRef === 'string' &&
    rootRef.startsWith('#/$defs/') &&
    newSchema.$defs
  ) {
    const defKey = decodeJsonPointerSegment(rootRef.slice('#/$defs/'.length));
    if (Object.hasOwn(newSchema.$defs, defKey)) {
      const def = newSchema.$defs[defKey];
      delete newSchema.$defs[defKey];
      const remainingDefs = newSchema.$defs;
      delete newSchema.$ref;
      delete newSchema.$defs;

      Object.assign(newSchema, def);

      if (Object.keys(remainingDefs).length > 0) {
        newSchema.$defs = remainingDefs;
      }
    }
  }

  return newSchema;
}

function normalizeRefs(
  rootSchema: JSONSchema.BaseSchema,
  io: 'input' | 'output',
) {
  return walkJsonSchema(rootSchema, (schema) => {
    if (typeof schema.$ref === 'string') {
      const match = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(schema.$ref);
      if (match) {
        const defKey = decodeJsonPointerSegment(match[1]);
        const targetKey = io === 'output' ? `${defKey}_Output` : defKey;
        schema.$ref = `#/$defs/${encodeJsonPointerSegment(targetKey)}`;
      }
    }
    return schema;
  });
}

function schemaHasRefs(jsonSchema: JSONSchema.BaseSchema) {
  let hasRefs = false;
  walkJsonSchema(jsonSchema, (schema) => {
    if (schema.$ref) {
      hasRefs = true;
    }
    return schema;
  });
  return hasRefs;
}

function isObjectTypeWithProperties(
  jsonSchema: JSONSchema.BaseSchema,
): jsonSchema is JSONSchema.BaseSchema & {
  type: 'object';
  required?: string[];
  properties?: Record<string, JSONSchema.BaseSchema>;
} {
  return (
    jsonSchema.type === 'object' &&
    !!jsonSchema.properties &&
    Object.keys(jsonSchema.properties).length > 0
  );
}
