import 'reflect-metadata';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { PREFIX } from '../const';
import { cleanupOpenApiDoc, createZodDto } from '../index';

test.each([
  {
    version: '3.0.3',
    target: undefined,
    nullable: { type: 'string', nullable: true },
    nullableAuthor: (authorId: string) => ({
      nullable: true,
      allOf: [{ $ref: '#/components/schemas/' + authorId }],
    }),
    literal: { type: 'boolean', enum: [false] },
    tuple: { items: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
  },
  {
    version: '3.1.1',
    target: 'draft-2020-12',
    nullable: { type: ['string', 'null'] },
    nullableAuthor: (authorId: string) => ({
      anyOf: [{ $ref: '#/components/schemas/' + authorId }, { type: 'null' }],
    }),
    literal: { type: 'boolean', const: false },
    tuple: {
      items: false,
      prefixItems: [{ type: 'number' }, { type: 'string' }],
    },
  },
] as const)(
  'generates native OpenAPI $version components',
  async ({ version, target, nullable, nullableAuthor, literal, tuple }) => {
    const author = z.object({ name: z.string().nullable() }).meta({
      id: 'Author' + version,
      description: 'Book author',
    });
    const book = z
      .object({
        author,
        coAuthor: author.nullable().optional(),
        flag: z.literal(false),
        pair: z.tuple([z.number(), z.string()]),
        payload: z.base64(),
        code: z
          .string()
          .regex(/^[a-z]/)
          .regex(/[0-9]$/),
        mixed: z.literal([1, 'a']),
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
      const rawDoc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Books')
          .setOpenAPIVersion(version)
          .build(),
      );
      const doc = cleanupOpenApiDoc(rawDoc);
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
            coAuthor: nullableAuthor(authorId),
            flag: literal,
            pair: { type: 'array', minItems: 2, maxItems: 2, ...tuple },
            code: {
              type: 'string',
              allOf: [
                expect.objectContaining({ pattern: '^[a-z]' }),
                expect.objectContaining({ pattern: '[0-9]$' }),
              ],
            },
            mixed: { enum: [1, 'a'] },
          },
          required: ['author', 'flag', 'pair', 'payload', 'code', 'mixed'],
        },
        [bookId + '_Output']: {
          additionalProperties: false,
          properties: {
            author: { $ref: '#/components/schemas/' + authorId + '_Output' },
          },
          required: [
            'author',
            'flag',
            'pair',
            'payload',
            'code',
            'mixed',
            'inPrint',
          ],
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
      expect(inputComponent.properties?.mixed).not.toHaveProperty('type');
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
      expect(JSON.stringify(doc)).not.toContain(PREFIX);
      expect(JSON.stringify(doc)).not.toMatch(/#\/(?:\$defs|definitions)\//);
    } finally {
      await app.close();
    }
  },
);

test('documents @Query() and @Param() DTOs natively', async () => {
  const tagSchema = z.enum(['a', 'b']).meta({ id: 'QueryTag' });
  class SearchQueryDto extends createZodDto(
    z.object({
      q: z.string().describe('Search term'),
      page: z.coerce.number().optional(),
      tag: tagSchema.optional(),
      filter: z
        .object({
          name: z.string().optional().describe('Filter by name'),
          active: z.boolean(),
        })
        .optional(),
    }),
  ) {}

  class ItemParamsDto extends createZodDto(
    z.object({
      id: z.string().transform((v) => parseInt(v, 10)),
    }),
  ) {}

  @Controller('items')
  class ItemsController {
    @Get()
    search(@Query() query: SearchQueryDto) {
      return query;
    }

    @Get(':id')
    getOne(@Param() params: ItemParamsDto) {
      return params;
    }
  }

  const module = await Test.createTestingModule({
    controllers: [ItemsController],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const doc = cleanupOpenApiDoc(
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Items').build(),
      ),
    );

    expect(doc.paths['/items']?.get?.parameters).toEqual([
      {
        name: 'q',
        in: 'query',
        required: true,
        description: 'Search term',
        schema: { type: 'string' },
      },
      {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      },
      {
        name: 'tag',
        in: 'query',
        required: false,
        schema: { allOf: [{ $ref: '#/components/schemas/QueryTag' }] },
      },
      {
        name: 'filter',
        in: 'query',
        required: false,
        style: 'deepObject',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Filter by name' },
            active: { type: 'boolean' },
          },
          required: ['active'],
        },
      },
    ]);
    expect(doc.paths['/items/{id}']?.get?.parameters).toEqual([
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ]);
    expect(doc.components?.schemas).toMatchObject({
      QueryTag: { type: 'string', enum: ['a', 'b'] },
    });
    expect(JSON.stringify(doc)).not.toContain(PREFIX);
  } finally {
    await app.close();
  }
});

test('documents non-object root DTOs (arrays, discriminated unions, empty objects)', async () => {
  const itemSchema = z.object({ id: z.string() }).meta({ id: 'Item' });
  class ItemListDto extends createZodDto(z.array(itemSchema)) {}
  const EventDto = createZodDto(
    z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('created'), id: z.string() }),
        z.object({ kind: z.literal('deleted'), reason: z.string() }),
      ])
      .meta({ id: 'EventDto' }),
  );
  class EmptyDto extends createZodDto(
    z.object({}).meta({ id: 'EmptyPayload', description: 'No fields' }),
  ) {}

  @Controller('roots')
  class RootsController {
    @Get('list')
    @ApiOkResponse({ type: ItemListDto.Output })
    list() {
      return [];
    }

    @Post('event')
    @ApiCreatedResponse({ type: EventDto })
    postEvent() {
      return {};
    }

    @Post('empty')
    postEmpty(@Body() body: EmptyDto) {
      return body;
    }
  }

  const module = await Test.createTestingModule({
    controllers: [RootsController],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const doc = cleanupOpenApiDoc(
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Roots').build(),
      ),
    );

    expect(doc.components?.schemas).toMatchObject({
      ItemListDto_Output: {
        type: 'array',
        items: { $ref: '#/components/schemas/Item_Output' },
      },
      Item_Output: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      EventDto: {
        oneOf: [
          expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              kind: { type: 'string', enum: ['created'] },
            }),
          }),
          expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              kind: { type: 'string', enum: ['deleted'] },
            }),
          }),
        ],
      },
      EmptyPayload: {
        type: 'object',
        description: 'No fields',
        properties: {},
      },
    });
    expect(doc.components?.schemas?.EventDto).not.toHaveProperty('type');
    expect(JSON.stringify(doc)).not.toContain(PREFIX);
  } finally {
    await app.close();
  }
});

test('resolves self-recursive, mutually recursive, and anonymous cyclic schemas', async () => {
  interface Node {
    value: string;
    next?: Node;
  }
  const nodeSchema: z.ZodType<Node> = z.object({
    value: z.string(),
    next: z.lazy(() => nodeSchema).optional(),
  });
  class NodeDto extends createZodDto(nodeSchema) {}

  interface Tree {
    label: string;
    children: Tree[];
  }
  const treeSchema: z.ZodType<Tree> = z.object({
    label: z.string(),
    children: z.array(z.lazy(() => treeSchema)),
  });
  class TreeWrapperDto extends createZodDto(
    z.object({ root: treeSchema }).meta({ id: 'TreeWrapper' }),
  ) {}

  interface Child {
    parent?: Root;
  }
  interface Root {
    child: Child;
  }
  const childSchema: z.ZodType<Child> = z
    .object({ parent: z.lazy(() => rootSchema).optional() })
    .meta({ id: 'CyclicChild' });
  const rootSchema: z.ZodType<Root> = z.object({ child: childSchema });
  class UnnamedCyclicRootDto extends createZodDto(rootSchema) {}

  @Controller('graph')
  class GraphController {
    @Post('node')
    @ApiCreatedResponse({ type: NodeDto.Output })
    createNode(@Body() body: NodeDto) {
      return body;
    }

    @Post('tree')
    createTree(@Body() body: TreeWrapperDto) {
      return body;
    }

    @Post('cyclic')
    createCyclic(@Body() body: UnnamedCyclicRootDto) {
      return body;
    }
  }

  const module = await Test.createTestingModule({
    controllers: [GraphController],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const doc = cleanupOpenApiDoc(
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Graph').build(),
      ),
    );
    expect(doc.components?.schemas).toMatchObject({
      NodeDto: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          next: { allOf: [{ $ref: '#/components/schemas/NodeDto' }] },
        },
      },
      NodeDto_Output: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          next: { allOf: [{ $ref: '#/components/schemas/NodeDto_Output' }] },
        },
      },
      TreeWrapper: {
        type: 'object',
        properties: {
          root: { $ref: '#/components/schemas/TreeWrapper__schema0' },
        },
      },
      TreeWrapper__schema0: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          children: {
            type: 'array',
            items: {
              allOf: [{ $ref: '#/components/schemas/TreeWrapper__schema0' }],
            },
          },
        },
      },
      UnnamedCyclicRootDto: {
        type: 'object',
        properties: {
          child: { $ref: '#/components/schemas/CyclicChild' },
        },
      },
      CyclicChild: {
        type: 'object',
        properties: {
          parent: {
            allOf: [{ $ref: '#/components/schemas/UnnamedCyclicRootDto' }],
          },
        },
      },
    });
    expect(JSON.stringify(doc)).not.toContain(PREFIX);
  } finally {
    await app.close();
  }
});

test('throws on conflicting duplicate schema names', async () => {
  class FirstDto extends createZodDto(
    z.object({ a: z.string() }).meta({ id: 'SharedName' }),
  ) {}
  class SecondDto extends createZodDto(
    z.object({ b: z.number() }).meta({ id: 'SharedName' }),
  ) {}

  @Controller('dup')
  class DupController {
    @Post('a')
    a(@Body() body: FirstDto) {
      return body;
    }

    @Post('b')
    b(@Body() body: SecondDto) {
      return body;
    }
  }

  const module = await Test.createTestingModule({
    controllers: [DupController],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const rawDoc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Dup').build(),
    );
    expect(() => cleanupOpenApiDoc(rawDoc)).toThrow(
      /Found multiple schemas with name `SharedName`/,
    );
  } finally {
    await app.close();
  }
});
