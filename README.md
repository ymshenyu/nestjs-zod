# @ymshenyu/nestjs-zod

A DTO-only fork of [nestjs-zod](https://github.com/BenLorantfy/nestjs-zod) for Zod 4.5+, NestJS 12, and @nestjs/swagger 12. It supports ESM and CommonJS on Node.js 20.19+ or 22.12+.

## Install

```sh
npm install @ymshenyu/nestjs-zod zod@^4.5.0 @nestjs/swagger@^12
```

## Define a DTO

```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common'
import { ApiCreatedResponse } from '@nestjs/swagger'
import { createZodDto } from '@ymshenyu/nestjs-zod'
import { z } from 'zod'

const Author = z.object({ name: z.string() }).meta({ id: 'Author' })
const Book = z.object({
  author: Author,
  title: z.string().min(1),
  subtitle: z.string().nullable(),
}).meta({ id: 'Book', description: 'A book in the catalog' })

class BookDto extends createZodDto(Book, { target: 'draft-2020-12' }) {}

@Controller('books')
export class BooksController {
  @Post()
  @ApiCreatedResponse({ type: BookDto.Output })
  create(@Body() body: BookDto) {
    const result = BookDto.schema.safeParse(body)
    if (!result.success) throw new BadRequestException(result.error.issues)
    return result.data
  }
}
```

`createZodDto` uses Zod's native `toJSONSchema` for object DTOs. Swagger discovers the class through the usual `@Body()` or response decorators. `.meta({ id })` names the root and nested components, which Swagger references under `#/components/schemas/`. The output version adds `_Output` to those names, so the request and response can use different schemas.

`Dto.schema` exposes the original Zod schema. `Dto.create(input)` parses it and throws a `ZodError` on failure. `Dto.Output` selects Zod's output schema for documentation.

## Choose the OpenAPI target

Use the same target for DTOs published in one Swagger document.

| OpenAPI version | `createZodDto` option |
| --- | --- |
| 3.0 | `{ target: 'openapi-3.0' }` or omit the option |
| 3.1 | `{ target: 'draft-2020-12' }` |

For the 3.1 example above, set the document version to match.

```ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

const config = new DocumentBuilder()
  .setTitle('Books')
  .setOpenAPIVersion('3.1.1')
  .build()

const document = SwaggerModule.createDocument(app, config)
SwaggerModule.setup('api', app, document)
```

Automatic documentation covers object bodies and responses. Use a Swagger response decorator with `type: [Dto.Output]` for an array of DTOs. Use Swagger's explicit `schema` option for root arrays, scalars, and unions, and `@ApiQuery` or `@ApiParam` for query and path parameters. Use Zod schemas that can be represented in the selected JSON Schema target.

OpenAPI 3.0 uses Zod's homogeneous array approximation for tuples. Choose 3.1 to document each tuple position. The native target also determines the representation of literals and nullable types. During 3.0 conversion the adapter omits the 3.1-only content encoding and media type keywords, which Zod can emit for base64 and file schemas. [Upstream encoding report](https://github.com/BenLorantfy/nestjs-zod/issues/476) [Upstream tuple report](https://github.com/BenLorantfy/nestjs-zod/issues/504) · [Upstream literal report](https://github.com/BenLorantfy/nestjs-zod/issues/505)

## Migrate from upstream

1. Import `createZodDto` and the `ZodDto` type from `@ymshenyu/nestjs-zod` and upgrade schemas to Zod 4.
2. Pass the result of `SwaggerModule.createDocument()` directly to `SwaggerModule.setup()`.
3. Replace `@ZodResponse` with a Swagger response decorator. Select `Dto.Output` to document the Zod output. Handle runtime request validation and response serialization in your application.
4. Move codec encoding into your application and document the schema for the encoded HTTP response.

The package includes just the class DTO factory. This fork retains the upstream MIT license and authorship.

## Develop and release

Run `corepack pnpm install --frozen-lockfile` and `corepack pnpm test` from the repository root. The workspace uses Vitest and includes a NestJS application test for each OpenAPI target.

Publishing a GitHub Release with a stable `vX.Y.Z` tag starts the release workflow. For `v1.0.0`, add a granular npm token with stage-only access to the scope as the repository Actions secret `NPM_STAGE_TOKEN`. Approve the resulting staged version on npm with 2FA, then delete the bootstrap secret. Configure npm Trusted Publishing for GitHub Actions with owner `ymshenyu`, repository `nestjs-zod`, and workflow `release.yml`. Enable `npm publish` for subsequent stable releases.

[Zod JSON Schema options](https://zod.dev/json-schema) · [npm staged publishing](https://docs.npmjs.com/staged-publishing/) · [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
