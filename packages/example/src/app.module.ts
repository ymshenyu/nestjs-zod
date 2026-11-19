import { Module } from '@nestjs/common';
import { PeopleController } from './people/people.controller';
import { StarshipsController } from './starships/starships.controller';

@Module({
  controllers: [PeopleController, StarshipsController],
})
export class AppModule {}
