import { expect, test } from 'vitest';
import { AppController } from './app.controller';

test('creates a book from the DTO', () => {
  expect(new AppController().createBook({ title: 'The Hobbit' })).toEqual({
    title: 'The Hobbit',
  });
});
