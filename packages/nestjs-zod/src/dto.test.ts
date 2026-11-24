import { expect, test } from 'vitest';
import { z } from 'zod';
import * as zMini from 'zod/v4-mini';
import { createZodDto, isZodDto } from './index.js';

test('creates a typed DTO and parses explicitly', () => {
  const schema = z.object({ count: z.coerce.number() });
  class CountDto extends createZodDto(schema) {}

  expect(CountDto.schema).toBe(schema);
  expect(CountDto.isZodDto).toBe(true);
  expect(isZodDto(CountDto)).toBe(true);
  expect(isZodDto(class Plain {})).toBe(false);
  expect(CountDto.create({ count: '42', extra: true })).toEqual({ count: 42 });
  expect(() => CountDto.create({ count: 'invalid' })).toThrow(z.ZodError);
  expect(CountDto.Output).toBe(CountDto.Output);
  expect(CountDto.Output.Output).toBe(CountDto.Output);
  expect(CountDto.Output.name).toBe('CountDto_Output');
});

test('supports zod/v4-mini schemas', () => {
  const schema = zMini.object({ name: zMini.string() });
  class MiniDto extends createZodDto(schema) {}

  expect(MiniDto.create({ name: 'Ada' })).toEqual({ name: 'Ada' });
  expect(MiniDto._OPENAPI_METADATA_FACTORY()).toMatchObject({
    name: { type: 'string', required: true },
  });
});

test('parses DTOs lazily even when their schema cannot be documented by Zod', () => {
  class DateDto extends createZodDto(z.object({ created: z.date() })) {}
  const created = new Date();
  expect(DateDto.create({ created })).toEqual({ created });
});
