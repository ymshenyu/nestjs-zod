import type { JSONSchema } from 'zod/v4/core';

export function decodeJsonPointerSegment(segment: string) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function encodeJsonPointerSegment(segment: string) {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function fixAllRefs({
  schema,
  defRenames,
  rootSchemaName,
}: {
  schema: JSONSchema.BaseSchema;
  defRenames?: Record<string, string>;
  rootSchemaName?: string;
}) {
  return walkJsonSchema(
    schema,
    (s) => {
      if (typeof s.$ref === 'string') {
        const match = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(s.$ref);
        if (match) {
          const decoded = decodeJsonPointerSegment(match[1]);
          const renamed = defRenames?.[decoded] ?? decoded;
          s.$ref = `#/components/schemas/${encodeJsonPointerSegment(renamed)}`;
        } else if (s.$ref === '#') {
          if (!rootSchemaName) {
            throw new Error(
              '[fixAllRefs] rootSchemaName is required when fixing a ref to #',
            );
          }
          s.$ref = `#/components/schemas/${encodeJsonPointerSegment(rootSchemaName)}`;
        }
      }

      return s;
    },
    { clone: true },
  );
}

export function walkJsonSchema(
  schema: JSONSchema.BaseSchema,
  callback: (schema: JSONSchema.BaseSchema) => JSONSchema.BaseSchema,
  options?: { clone?: boolean },
): JSONSchema.BaseSchema {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const current = callback(options?.clone ? structuredClone(schema) : schema);

  if (!current || typeof current !== 'object') {
    return current;
  }

  const record = current as Record<string, unknown>;

  for (const mapKey of ['properties', 'patternProperties'] as const) {
    const mapValue = record[mapKey];
    if (mapValue && typeof mapValue === 'object') {
      const entries = mapValue as Record<string, unknown>;
      for (const key of Object.keys(entries)) {
        const child = entries[key];
        if (child && typeof child === 'object') {
          entries[key] = walkJsonSchema(
            child as JSONSchema.BaseSchema,
            callback,
          );
        }
      }
    }
  }

  for (const arrayKey of ['prefixItems', 'oneOf', 'anyOf', 'allOf'] as const) {
    const list = record[arrayKey];
    if (Array.isArray(list)) {
      record[arrayKey] = list.map((item) =>
        item && typeof item === 'object'
          ? walkJsonSchema(item as JSONSchema.BaseSchema, callback)
          : item,
      );
    }
  }

  if (Array.isArray(current.items)) {
    current.items = current.items.map((item) =>
      item && typeof item === 'object'
        ? walkJsonSchema(item as JSONSchema.BaseSchema, callback)
        : item,
    );
  } else if (current.items && typeof current.items === 'object') {
    current.items = walkJsonSchema(
      current.items as JSONSchema.BaseSchema,
      callback,
    );
  }

  if (
    current.additionalProperties &&
    typeof current.additionalProperties === 'object'
  ) {
    current.additionalProperties = walkJsonSchema(
      current.additionalProperties as JSONSchema.BaseSchema,
      callback,
    );
  }

  if (current.propertyNames && typeof current.propertyNames === 'object') {
    current.propertyNames = walkJsonSchema(
      current.propertyNames as JSONSchema.BaseSchema,
      callback,
    );
  }

  return current;
}
