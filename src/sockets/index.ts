import { Server as SocketIOServer } from 'socket.io';
import { setupSocketHandlers } from './socketHandlers';
import { setupChatHandlers } from './chatHandlers';

export const initializeSocketIO = (io: SocketIOServer): void => {
  // Setup main socket handlers (authentication, blood requests, etc.)
  setupSocketHandlers(io);
  
  // Setup chat-specific socket handlers
  setupChatHandlers(io);
  
  console.log('🚀 All socket handlers initialized successfully');
};