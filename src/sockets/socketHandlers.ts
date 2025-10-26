import { Server as SocketIOServer, Socket } from 'socket.io';

export const setupSocketHandlers = (io: SocketIOServer): void => {
  io.on('connection', (socket: Socket) => {
    console.log('🔌 New client connected:', socket.id);
    console.log('📡 Total connected clients:', io.engine.clientsCount);

    // Send welcome message
    socket.emit('welcome', { 
      message: 'Welcome to LifeStream Real-Time Service!', 
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    // Join user to their personal room
    socket.on('join-user', (userId: string) => {
      socket.join(`user:${userId}`);
      console.log(`User ${userId} joined their room`);
      socket.emit('joined-room', { 
        room: `user:${userId}`,
        userId: userId 
      });
    });

    // Handle real-time blood request
    socket.on('create-request', (requestData) => {
      console.log('🆕 New blood request received:', requestData);
      
      // Broadcast to all connected clients except sender
      socket.broadcast.emit('new-blood-request', {
        ...requestData,
        id: Date.now(),
        createdAt: new Date().toISOString()
      });
      
      // Confirm to sender
      socket.emit('request-created', { 
        status: 'success', 
        requestId: Date.now(),
        message: 'Blood request broadcasted to nearby donors'
      });
    });

    // Handle donor response
    socket.on('donor-response', (responseData) => {
      const { requestId, donorId, message } = responseData;
      console.log(`Donor ${donorId} responded to request ${requestId}`);
      
      // Notify the requester
      io.to(`request:${requestId}`).emit('donor-available', {
        donorId,
        message,
        responseTime: new Date().toISOString()
      });
    });

    // Handle chat messages
    socket.on('send-message', (messageData) => {
      const { conversationId, message, senderId } = messageData;
      console.log(`New message in conversation ${conversationId} from ${senderId}`);
      
      // Broadcast to conversation room
      io.to(`conversation:${conversationId}`).emit('new-message', {
        ...messageData,
        timestamp: new Date().toISOString(),
        messageId: Date.now()
      });
    });

    // Handle location updates
    socket.on('update-location', (locationData) => {
      const { userId, latitude, longitude } = locationData;
      console.log(`Location update from user ${userId}`);
      
      // Broadcast to relevant users
      socket.broadcast.emit('location-updated', {
        userId,
        location: { latitude, longitude },
        timestamp: new Date().toISOString()
      });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log('🔌 Client disconnected:', socket.id, 'Reason:', reason);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  console.log('✅ Socket.io handlers setup complete');
};