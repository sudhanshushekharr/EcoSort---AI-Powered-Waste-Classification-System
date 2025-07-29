// lib/socketio.ts
import { Server as SocketIOServer } from 'socket.io';

// Global variable to store the Socket.IO instance
let io: SocketIOServer | null = null;

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function setSocketIO(socketIO: SocketIOServer): void {
  io = socketIO;
}
