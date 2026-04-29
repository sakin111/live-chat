import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthService } from '../auth/auth.service';
import { RoomsService } from '../rooms/rooms.service';
import { REDIS, REDIS_SUB } from '../redis/redis.module';

@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  // Map socketId -> { username, roomId } — stored in Redis, not memory
  constructor(
    @Inject(REDIS) private redis: Redis,
    @Inject(REDIS_SUB) private redisSub: Redis,
    private authService: AuthService,
    private roomsService: RoomsService,
  ) {}

  onModuleInit() {
    // Subscribe to Redis channels for message fan-out and room deletion
    this.redisSub.psubscribe('room:*:message:new', 'room:*:deleted');

    this.redisSub.on('pmessage', async (pattern, channel, data) => {
      if (channel.endsWith(':message:new')) {
        const roomId = channel.split(':')[1];
        const payload = JSON.parse(data);
        this.server.to(roomId).emit('message:new', {
          id: payload.id,
          username: payload.username,
          content: payload.content,
          createdAt: payload.createdAt,
        });
      }

      if (channel.endsWith(':deleted')) {
        const roomId = channel.split(':')[1];
        const payload = JSON.parse(data);
        this.server.to(roomId).emit('room:deleted', { roomId: payload.roomId });
      }
    });
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.query.token as string;
    const roomId = client.handshake.query.roomId as string;

    // Validate token
    const session = token ? await this.authService.validateToken(token) : null;
    if (!session) {
      client.emit('error', { code: 401, message: 'Missing or expired session token' });
      client.disconnect();
      return;
    }

    // Validate room
    const roomExists = await this.roomsService.roomExists(roomId);
    if (!roomExists) {
      client.emit('error', { code: 404, message: 'Room not found' });
      client.disconnect();
      return;
    }

    const { username } = session;

    // Store socket state in Redis
    await this.redis.setex(
      `socket:${client.id}`,
      86400,
      JSON.stringify({ username, roomId }),
    );

    // Join Socket.io room
    client.join(roomId);

    // Add to active users set
    await this.roomsService.addActiveUser(roomId, username);
    const activeUsers = await this.roomsService.getActiveUsers(roomId);

    // Emit room:joined to connecting client only
    client.emit('room:joined', { activeUsers });

    // Broadcast room:user_joined to all other clients in the room
    client.to(roomId).emit('room:user_joined', { username, activeUsers });
  }

  async handleDisconnect(client: Socket) {
    await this.cleanupClient(client);
  }

  @SubscribeMessage('room:leave')
  async handleLeave(client: Socket) {
    await this.cleanupClient(client);
    client.disconnect();
  }

  private async cleanupClient(client: Socket) {
    const raw = await this.redis.get(`socket:${client.id}`);
    if (!raw) return;

    const { username, roomId } = JSON.parse(raw);

    await this.redis.del(`socket:${client.id}`);
    await this.roomsService.removeActiveUser(roomId, username);

    const activeUsers = await this.roomsService.getActiveUsers(roomId);

    // Broadcast departure to remaining clients
    this.server.to(roomId).emit('room:user_left', { username, activeUsers });
  }
}

// Separate service to publish room:deleted events from REST controller
