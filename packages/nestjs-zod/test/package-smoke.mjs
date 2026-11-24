import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanupOpenApiDoc,
  createZodDto,
  isZodDto,
} from '@ymshenyu/nestjs-zod';
import * as dto from '@ymshenyu/nestjs-zod/dto';
import { z } from 'zod';

test('loads both build entries as ESM', () => {
  assert.equal(typeof cleanupOpenApiDoc, 'function');
  assert.equal(dto.createZodDto, createZodDto);
  assert.equal(dto.isZodDto, isZodDto);

  const schema = z.object({ name: z.string() });
  const NameDto = dto.createZodDto(schema);
  assert.ok(isZodDto(NameDto));
  assert.deepEqual(NameDto.create({ name: 'Ada' }), { name: 'Ada' });
});
