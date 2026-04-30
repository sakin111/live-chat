'use client';

import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Users, Hash, Settings, LogIn, Loader2 } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000/api/v1';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000/chat';

interface Message {
  id: string;
  username: string;
  content: string;
  createdAt: string;
  isMe?: boolean;
}

interface Room {
  id: string;
  name: string;
  createdAt: string;
}

export default function ChatLayout() {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      
      if (data.sessionToken) {
        setToken(data.sessionToken);
        setUser(data.user);
        fetchRooms(data.sessionToken);
      }
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch Rooms
  const fetchRooms = async (authToken: string) => {
    try {
      const res = await fetch(`${API_BASE}/rooms`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (data.rooms) {
        setRooms(data.rooms);
        if (data.rooms.length > 0 && !selectedRoomId) {
          setSelectedRoomId(data.rooms[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    }
  };

  // Fetch Messages
  const fetchMessages = async (roomId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/rooms/${roomId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages.map((m: any) => ({
          ...m,
          isMe: m.username === user?.username
        })));
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  // WebSocket Connection
  useEffect(() => {
    if (!token || !selectedRoomId) return;

    // Disconnect previous socket if exists
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setIsConnecting(true);
    fetchMessages(selectedRoomId);

    const socket = io(SOCKET_URL, {
      query: { token, roomId: selectedRoomId },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setIsConnecting(false);
      console.log('Connected to chat socket');
    });

    socket.on('room:joined', (data) => {
      setActiveUsers(data.activeUsers);
    });

    socket.on('room:user_joined', (data) => {
      setActiveUsers(data.activeUsers);
    });

    socket.on('room:user_left', (data) => {
      setActiveUsers(data.activeUsers);
    });

    socket.on('message:new', (data) => {
      setMessages((prev) => [...prev, {
        ...data,
        isMe: data.username === user?.username
      }]);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [token, selectedRoomId]);

  // Send Message
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedRoomId || !token) return;

    const content = newMessage;
    setNewMessage('');

    try {
      await fetch(`${API_BASE}/rooms/${selectedRoomId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // If not logged in, show login screen
  if (!token) {
    return (
      <Card className="w-full max-w-md p-8 border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/20">
            <span className="text-2xl font-bold text-white">A</span>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Join AnonChat</h1>
            <p className="text-sm text-muted-foreground text-balance">
              Enter a username to start chatting anonymously. No password required.
            </p>
          </div>
          <form onSubmit={handleLogin} className="w-full space-y-4 mt-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Pick a username..."
              className="h-12 border-white/10 bg-white/5 text-white placeholder:text-muted-foreground focus:ring-indigo-500"
              required
              autoFocus
            />
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="flex items-center gap-2">
                  <LogIn size={18} />
                  <span>Start Chatting</span>
                </div>
              )}
            </Button>
          </form>
        </div>
      </Card>
    );
  }

  const activeRoom = rooms.find(r => r.id === selectedRoomId);

  return (
    <div className="flex h-full w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-background/60 shadow-2xl backdrop-blur-xl">
      {/* Sidebar */}
      <div className="flex w-72 flex-col border-r border-white/10 bg-black/20">
        <div className="p-6">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500">
              <span className="text-white">A</span>
            </div>
            AnonChat
          </h1>
        </div>
        
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Rooms
              </h2>
              <div className="space-y-1">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => setSelectedRoomId(room.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                      selectedRoomId === room.id
                        ? 'bg-indigo-500/15 text-indigo-300'
                        : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Hash size={16} className={selectedRoomId === room.id ? 'text-indigo-400' : 'text-muted-foreground'} />
                    {room.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-black/20 p-3">
            <Avatar className="h-10 w-10 border border-white/10">
              <AvatarFallback className="bg-indigo-500 text-white">
                {user?.username?.[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium text-white">{user?.username}</p>
              <p className="truncate text-xs text-green-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                Online
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white">
              <Settings size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col bg-black/40">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20">
              <Hash className="text-indigo-400" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{activeRoom?.name || 'Loading...'}</h2>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Users size={12} />
                {activeUsers.length} members online
              </p>
            </div>
          </div>
          {isConnecting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting...
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 p-6">
          <div className="flex flex-col gap-6">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <Hash size={24} className="text-muted-foreground" />
                </div>
                <h3 className="text-white font-medium">No messages yet</h3>
                <p className="text-sm text-muted-foreground">Be the first to say hello!</p>
              </div>
            ) : messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex max-w-[80%] flex-col gap-1 ${
                  msg.isMe ? 'self-end' : 'self-start'
                }`}
              >
                {!msg.isMe && (
                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                    {msg.username} • {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {msg.isMe && (
                  <span className="mr-1 text-xs font-medium text-muted-foreground self-end">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <div className={`flex gap-3 ${msg.isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!msg.isMe && (
                    <Avatar className="h-8 w-8 border border-white/10 shadow-sm mt-1">
                      <AvatarFallback className="bg-slate-700 text-xs">{msg.username[0].toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={`rounded-2xl px-5 py-3 text-sm shadow-md break-words ${
                      msg.isMe
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-slate-800/80 text-slate-100 border border-white/5 rounded-tl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 bg-black/20 backdrop-blur-md border-t border-white/10">
          <form
            onSubmit={sendMessage}
            className="relative flex items-center gap-2"
          >
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={`Message #${activeRoom?.name || '...'}`}
              className="h-12 border-white/10 bg-black/40 pl-4 pr-12 text-sm text-white placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-indigo-500 rounded-xl"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!newMessage.trim() || isConnecting}
              className="absolute right-1.5 h-9 w-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            >
              <Send size={16} />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
