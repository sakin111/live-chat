import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { User } from '../common/decorators/user.decorator';

@Controller('rooms')
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  async findAll() {
    const rooms = await this.roomsService.findAll();
    return { rooms };
  }

  @Post()
  async create(@Body() createRoomDto: CreateRoomDto, @User() user: { username: string }) {
    return this.roomsService.create(createRoomDto.name, user.username);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @User() user: { username: string }) {
    return this.roomsService.delete(id, user.username);
  }
}
