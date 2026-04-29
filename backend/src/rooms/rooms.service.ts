import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { customAlphabet } from 'nanoid';
import { DRIZZLE } from '../database/database.module';
import { REDIS } from '../redis/redis.module';
import * as schema from '../schema';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

@Injectable()
export class RoomsService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private redis: Redis,
  ) {}

  async findAll() {
    const rooms = await this.db.select().from(schema.rooms);

    const roomsWithUsers = await Promise.all(
      rooms.map(async (room) => {
        const activeUsers = await this.redis.scard(`room:${room.id}:users`);
        return {
          id: room.id,
          name: room.name,
          createdBy: room.createdBy,
          activeUsers,
          createdAt: room.createdAt,
        };
      }),
    );

    return roomsWithUsers;
  }

  async findOne(id: string) {
    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id));

    if (!room) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: `Room with id ${id} does not exist`,
        },
      });
    }

    const activeUsers = await this.redis.scard(`room:${room.id}:users`);

    return {
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      activeUsers,
      createdAt: room.createdAt,
    };
  }

  async create(name: string, username: string) {
    const existing = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.name, name));

    if (existing.length > 0) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'ROOM_NAME_TAKEN',
          message: 'A room with this name already exists',
        },
      });
    }

    const id = `room_${nanoid()}`;
    const [room] = await this.db
      .insert(schema.rooms)
      .values({ id, name, createdBy: username })
      .returning();

    return {
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    };
  }

  async delete(id: string, username: string) {
    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id));

    if (!room) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: `Room with id ${id} does not exist`,
        },
      });
    }

    if (room.createdBy !== username) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the room creator can delete this room',
        },
      });
    }

    // Delete room (messages cascade via FK)
    await this.db.delete(schema.rooms).where(eq(schema.rooms.id, id));

    // Clean up Redis active users set
    await this.redis.del(`room:${id}:users`);

    // Broadcast room:deleted
    await this.redis.publish(
      `room:${id}:deleted`,
      JSON.stringify({ roomId: id })
    );

    return { deleted: true };
  }

  async roomExists(id: string): Promise<boolean> {
    const [room] = await this.db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id));
    return !!room;
  }

  // Redis active user management
  async addActiveUser(roomId: string, username: string): Promise<void> {
    await this.redis.sadd(`room:${roomId}:users`, username);
  }

  async removeActiveUser(roomId: string, username: string): Promise<void> {
    await this.redis.srem(`room:${roomId}:users`, username);
  }

  async getActiveUsers(roomId: string): Promise<string[]> {
    return this.redis.smembers(`room:${roomId}:users`);
  }

  async getActiveUserCount(roomId: string): Promise<number> {
    return this.redis.scard(`room:${roomId}:users`);
  }
}
