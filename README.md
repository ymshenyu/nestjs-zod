# @ymshenyu/nestjs-zod

A DTO-only fork of [nestjs-zod](https://github.com/BenLorantfy/nestjs-zod) for Zod 4.5+, NestJS 12, and `@nestjs/swagger` 12 using Zod's native `toJSONSchema`. It ships as ESM on Node.js 20.19+ or 22.12+.

## Install

```sh
npm install @ymshenyu/nestjs-zod zod@^4.5.0
```

`@nestjs/swagger` (`^12.0.0`) is an optional peer dependency—only required when generating OpenAPI documentation.

## Define a DTO

```ts
import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger'
import { createZodDto } from '@ymshenyu/nestjs-zod'
import { z } from 'zod'

const Author = z.object({ name: z.string() }).meta({ id: 'Author' })
const Book = z.object({
  author: Author,
  title: z.string().min(1),
  subtitle: z.string().nullable(),
}).meta({ id: 'Book', description: 'A book in the catalog' })

class BookDto extends createZodDto(Book, { target: 'draft-2020-12' }) {}
class BookListDto extends createZodDto(z.array(Book), { target: 'draft-2020-12' }) {}
class BookQueryDto extends createZodDto(
  z.object({ q: z.string().optional() }),
  { target: 'draft-2020-12' },
) {}

@Controller('books')
export class BooksController {
  @Get()
  @ApiOkResponse({ type: BookListDto.Output })
  list(@Query() query: BookQueryDto) {
    return []
  }

  @Post()
  @ApiCreatedResponse({ type: BookDto.Output })
  create(@Body() body: BookDto) {
    const result = BookDto.schema.safeParse(body)
    if (!result.success) throw new BadRequestException(result.error.issues)
    return result.data
  }
}
```

`createZodDto` uses Zod's native `toJSONSchema` lazily when Swagger scans your controllers. Pass the generated Swagger document through `cleanupOpenApiDoc` in `main.ts`:

```ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { cleanupOpenApiDoc } from '@ymshenyu/nestjs-zod'

const config = new DocumentBuilder()
  .setTitle('Books')
  .setOpenAPIVersion('3.1.1')
  .build()

const document = SwaggerModule.createDocument(app, config)
SwaggerModule.setup('api', app, cleanupOpenApiDoc(document))
```

This supports `@Body()`, `@Query()` (including nested objects with `deepObject` style), `@Param()`, response decorators, non-object root DTOs (arrays, unions, discriminated unions, scalars), recursive schemas, and `.meta({ id })` component extraction.

`Dto.schema` exposes the original Zod schema. `Dto.create(input)` parses it and throws a `ZodError` on failure. `Dto.Output` selects Zod's output schema for documentation (adding `_Output` to component names).

## Choose the OpenAPI target

Use the same target for DTOs published in one Swagger document.

| OpenAPI version | `createZodDto` option |
| --- | --- |
| 3.0 | `{ target: 'openapi-3.0' }` or omit the option |
| 3.1 | `{ target: 'draft-2020-12' }` |

OpenAPI 3.0 uses Zod's homogeneous array approximation for tuples. Choose 3.1 to document each tuple position. The native target also determines the representation of literals and nullable types. During 3.0 conversion the adapter omits the 3.1-only `contentEncoding` and `contentMediaType` keywords, which Zod can emit for base64 and file schemas. [Upstream encoding report](https://github.com/BenLorantfy/nestjs-zod/issues/476) · [Upstream tuple report](https://github.com/BenLorantfy/nestjs-zod/issues/504) · [Upstream literal report](https://github.com/BenLorantfy/nestjs-zod/issues/505)

## Migrate from upstream

1. Import `createZodDto`, `cleanupOpenApiDoc`, and types from `@ymshenyu/nestjs-zod` and upgrade schemas to Zod 4.
2. Keep `cleanupOpenApiDoc(openApiDoc)` in `SwaggerModule.setup()`. For OpenAPI 3.1 documents, pass `{ target: 'draft-2020-12' }` to `createZodDto`.
3. Replace `@ZodResponse` with a Swagger response decorator (`@ApiOkResponse`, `@ApiCreatedResponse`, etc.) and use `Dto.Output` to document the Zod output. Handle runtime request validation and response serialization in your application.
4. Move codec encoding into your application and document the schema for the encoded HTTP response.

This fork retains the upstream MIT license and authorship.

## Develop and release

Development and release CI use the Node.js LTS version pinned in `.node-version` and the pnpm version in the root `package.json`. Builds and type checks use native TypeScript 7. Oxlint checks source code and Oxfmt formats it.

Run `pnpm install --frozen-lockfile`, `pnpm --filter @ymshenyu/nestjs-zod build`, and `pnpm --filter @ymshenyu/nestjs-zod test` from the repository root. The package uses Vitest and includes NestJS Swagger integration tests for both OpenAPI targets. Run `pnpm --filter @ymshenyu/nestjs-zod test:package` after building to verify the ESM package entries.

Publishing a GitHub Release or running the `Release` workflow manually (`workflow_dispatch`) triggers `.github/workflows/release.yml`. If the repository Actions secret `NPM_STAGE_TOKEN` is set, the workflow submits a staged release via `npm stage publish --access public` for manual 2FA approval on npm; once `NPM_STAGE_TOKEN` is removed and npm Trusted Publishing (OIDC) is configured for `ymshenyu/nestjs-zod` and `release.yml`, it runs `npm publish --access public` directly.

[Zod JSON Schema options](https://zod.dev/json-schema) · [npm staged publishing](https://docs.npmjs.com/staged-publishing/) · [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
