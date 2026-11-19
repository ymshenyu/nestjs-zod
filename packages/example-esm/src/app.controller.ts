import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { createZodDto } from '@ymshenyu/nestjs-zod';
import { z } from 'zod';
import { AppService } from './app.service';

class BookDto extends createZodDto(
  z
    .object({
      title: z.string().describe('The title of the book'),
    })
    .meta({ id: 'Book' }),
  { target: 'draft-2020-12' },
) {}

class BookListDto extends createZodDto(z.array(BookDto.schema), {
  target: 'draft-2020-12',
}) {}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/books')
  @ApiOkResponse({ type: BookListDto.Output })
  getBooks() {
    return [];
  }
}
