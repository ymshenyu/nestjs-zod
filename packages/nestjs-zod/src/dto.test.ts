import { expect, test } from 'vitest';
import { z } from 'zod';
import { createZodDto } from './index';

test('creates a typed DTO and parses explicitly', () => {
  const schema = z.object({ count: z.coerce.number() });
  class CountDto extends createZodDto(schema) {}

  expect(CountDto.schema).toBe(schema);
  expect(CountDto.isZodDto).toBe(true);
  expect(CountDto.create({ count: '42', extra: true })).toEqual({ count: 42 });
  expect(() => CountDto.create({ count: 'invalid' })).toThrow(z.ZodError);
  expect(CountDto.Output).toBe(CountDto.Output);
  expect(CountDto.Output.name).toBe('CountDto_Output');
});

test('parses DTOs even when their schema cannot be documented by Zod', () => {
  class DateDto extends createZodDto(z.object({ created: z.date() })) {}
  const created = new Date();
  expect(DateDto.create({ created })).toEqual({ created });
});
