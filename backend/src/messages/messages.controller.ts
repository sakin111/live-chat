import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { User } from '../common/decorators/user.decorator';
import { RoomsService } from '../rooms/rooms.service';
import { NotFoundException } from '@nestjs/common';

@Controller('rooms/:id/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly roomsService: RoomsService,
  ) {}

  @Get()
  async getMessages(
    @Param('id') roomId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('before') before?: string,
  ) {
    const roomExists = await this.roomsService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: `Room with id ${roomId} does not exist`,
        },
      });
    }

    const { messages, hasMore, nextCursor } = await this.messagesService.getMessages(roomId, limit, before);
    return { messages, hasMore, nextCursor };
  }

  @Post()
  async createMessage(
    @Param('id') roomId: string,
    @Body('content') content: string,
    @User() user: { username: string },
  ) {
    const roomExists = await this.roomsService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: `Room with id ${roomId} does not exist`,
        },
      });
    }

    return this.messagesService.createMessage(roomId, user.username, content);
  }
}
