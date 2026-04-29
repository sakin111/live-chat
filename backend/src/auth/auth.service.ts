import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { customAlphabet } from 'nanoid';
import { DRIZZLE } from '../database/database.module';
import { REDIS } from '../redis/redis.module';
import * as schema from '../schema';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10);
const tokenId = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 48);

@Injectable()
export class AuthService {
  private readonly SESSION_TTL: number;

  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private redis: Redis,
    private config: ConfigService,
  ) {
    this.SESSION_TTL = config.get<number>('SESSION_TTL_SECONDS', 86400);
  }

  async login(username: string) {
    // Get or create user
    let [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username));

    if (!user) {
      const id = `usr_${nanoid()}`;
      [user] = await this.db
        .insert(schema.users)
        .values({ id, username })
        .returning();
    }

    // Create fresh session token
    const sessionToken = tokenId();
    const sessionKey = `session:${sessionToken}`;
    await this.redis.setex(
      sessionKey,
      this.SESSION_TTL,
      JSON.stringify({ userId: user.id, username: user.username }),
    );

    return {
      sessionToken,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      },
    };
  }

  async validateToken(token: string): Promise<{ userId: string; username: string } | null> {
    const raw = await this.redis.get(`session:${token}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }
}
