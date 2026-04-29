import { Injectable, Inject, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { eq, lt, desc, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { customAlphabet } from 'nanoid';
import { DRIZZLE } from '../database/database.module';
import { REDIS } from '../redis/redis.module';
import * as schema from '../schema';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private redis: Redis,
  ) {}

  async getMessages(roomId: string, limit = 50, before?: string) {
    const clampedLimit = Math.min(limit, 100);

    let query = this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(clampedLimit + 1);

    if (before) {
      // Get the cursor message's timestamp for cursor-based pagination
      const [cursorMsg] = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, before));

      if (cursorMsg) {
        query = this.db
          .select()
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.roomId, roomId),
              lt(schema.messages.createdAt, cursorMsg.createdAt)
            )
          )
          .orderBy(desc(schema.messages.createdAt))
          .limit(clampedLimit + 1);
      }
    }

    const rows = await query;

    const hasMore = rows.length > clampedLimit;
    const messages = rows.slice(0, clampedLimit).map((m) => ({
      id: m.id,
      roomId: m.roomId,
      username: m.username,
      content: m.content,
      createdAt: m.createdAt,
    }));

    const nextCursor = hasMore ? messages[messages.length - 1].id : null;

    return { messages, hasMore, nextCursor };
  }

  async createMessage(roomId: string, username: string, content: string) {
    const trimmed = content.trim();

    if (!trimmed) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'MESSAGE_EMPTY',
          message: 'Message content cannot be empty',
        },
      });
    }

    if (trimmed.length > 1000) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'MESSAGE_TOO_LONG',
          message: 'Message content must not exceed 1000 characters',
        },
      });
    }

    const id = `msg_${nanoid()}`;
    const [message] = await this.db
      .insert(schema.messages)
      .values({ id, roomId, username, content: trimmed })
      .returning();

    const payload = {
      id: message.id,
      roomId: message.roomId,
      username: message.username,
      content: message.content,
      createdAt: message.createdAt,
    };

    // Publish to Redis for WebSocket fan-out
    await this.redis.publish(
      `room:${roomId}:message:new`,
      JSON.stringify(payload),
    );

    return payload;
  }
}
