import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { createZodDto } from '@ymshenyu/nestjs-zod';
import { z } from 'zod';

class BookDto extends createZodDto(
  z.object({ title: z.string().describe('The title of the book') }).meta({
    id: 'Book',
  }),
  { target: 'draft-2020-12' },
) {}

@Controller('books')
export class AppController {
  @Post()
  @ApiCreatedResponse({ type: BookDto.Output })
  createBook(@Body() book: BookDto) {
    return BookDto.create(book);
  }
}
