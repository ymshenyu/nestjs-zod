import 'reflect-metadata';
import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { createZodDto } from '../index';

test.each([
  {
    version: '3.0.3',
    target: undefined,
    nullable: { type: 'string', nullable: true },
    literal: { type: 'boolean', enum: [false] },
    tuple: { items: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
  },
  {
    version: '3.1.1',
    target: 'draft-2020-12',
    nullable: { type: ['string', 'null'] },
    literal: { type: 'boolean', const: false },
    tuple: {
      items: false,
      prefixItems: [{ type: 'number' }, { type: 'string' }],
    },
  },
] as const)(
  'generates native OpenAPI $version components',
  async ({ version, target, nullable, literal, tuple }) => {
    const author = z.object({ name: z.string().nullable() }).meta({
      id: 'Author' + version,
      description: 'Book author',
    });
    const book = z
      .object({
        author,
        flag: z.literal(false),
        pair: z.tuple([z.number(), z.string()]),
        payload: z.base64(),
        inPrint: z.boolean().default(true),
      })
      .meta({ id: 'Book' + version, title: 'Book' });
    class BookDto extends createZodDto(book, { target }) {}

    @Controller('books')
    class BooksController {
      @Post()
      @ApiCreatedResponse({ type: BookDto.Output })
      create(@Body() body: BookDto) {
        return body;
      }

      @Get()
      @ApiOkResponse({ type: [BookDto.Output] })
      list() {
        return [];
      }
    }

    const module = await Test.createTestingModule({
      controllers: [BooksController],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Books')
          .setOpenAPIVersion(version)
          .build(),
      );
      const bookId = 'Book' + version;
      const authorId = 'Author' + version;
      const schemas = doc.components?.schemas;

      expect(doc.openapi).toBe(version);
      expect(doc.paths['/books']?.post?.requestBody).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/' + bookId },
          },
        },
      });
      expect(doc.paths['/books']?.post?.responses['201']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/' + bookId + '_Output' },
          },
        },
      });
      expect(doc.paths['/books']?.get?.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/' + bookId + '_Output' },
            },
          },
        },
      });
      expect(schemas).toMatchObject({
        [bookId]: {
          title: 'Book',
          type: 'object',
          properties: {
            author: { $ref: '#/components/schemas/' + authorId },
            flag: literal,
            pair: { type: 'array', minItems: 2, maxItems: 2, ...tuple },
          },
          required: ['author', 'flag', 'pair', 'payload'],
        },
        [bookId + '_Output']: {
          additionalProperties: false,
          properties: {
            author: { $ref: '#/components/schemas/' + authorId + '_Output' },
          },
          required: ['author', 'flag', 'pair', 'payload', 'inPrint'],
        },
        [authorId]: {
          description: 'Book author',
          properties: { name: nullable },
        },
        [authorId + '_Output']: { properties: { name: nullable } },
      });
      const inputComponent = schemas?.[bookId];
      if (!inputComponent || !('properties' in inputComponent)) {
        throw new Error('Missing input model properties');
      }
      const payload = inputComponent.properties?.payload;
      expect(payload).toMatchObject({ type: 'string', format: 'base64' });
      if (target) {
        expect(payload).toHaveProperty('contentEncoding', 'base64');
      } else {
        expect(payload).not.toHaveProperty('contentEncoding');
      }
      expect(Object.keys(schemas ?? {}).sort()).toEqual(
        [authorId, authorId + '_Output', bookId, bookId + '_Output'].sort(),
      );
      expect(JSON.stringify(doc)).not.toMatch(/#\/(?:\$defs|definitions)\//);
    } finally {
      await app.close();
    }
  },
);
