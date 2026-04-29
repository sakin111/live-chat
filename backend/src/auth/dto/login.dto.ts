import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(2, 24)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'username must contain only alphanumeric characters and underscores' })
  username: string;
}
