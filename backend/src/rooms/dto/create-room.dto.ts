import { IsString, Length, Matches } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9-]+$/, { message: 'name must contain only alphanumeric characters and hyphens' })
  name: string;
}
