import { Server as SocketIOServer, Socket } from 'socket.io';
import { pool } from '../config/database';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: number; // Changed to number to match database
    email: string;
    userType: string;
  };
}

export const setupSocketHandlers = (io: SocketIOServer): void => {
  // Authentication middleware for sockets
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as any;
      
      // Verify user exists in database
      const userResult = await pool.query(
        'SELECT id, email, user_type FROM users WHERE id = $1',
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = {
        id: userResult.rows[0].id, // This will be integer
        email: userResult.rows[0].email,
        userType: userResult.rows[0].user_type
      };
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('🔌 New client connected:', socket.id, 'User:', socket.user?.email);
    console.log('📡 Total connected clients:', io.engine.clientsCount);

    // Send welcome message
    socket.emit('welcome', { 
      message: 'Welcome to LifeStream Real-Time Service!', 
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    // Join user to their personal room
    socket.on('join-user', (userId: string) => {
      const userIdNum = parseInt(userId);
      if (socket.user?.id !== userIdNum) {
        socket.emit('error', { message: 'Unauthorized user join attempt' });
        return;
      }
      
      socket.join(`user:${userId}`);
      console.log(`User ${userId} joined their room`);
      socket.emit('joined-room', { 
        room: `user:${userId}`,
        userId: userId 
      });
    });

    // Handle real-time blood request
    socket.on('create-request', async (requestData) => {
      console.log('🆕 New blood request received:', requestData);
      
      try {
        // Save to database
        const result = await pool.query(
          `INSERT INTO blood_requests 
           (requester_id, patient_name, blood_type, units_needed, hospital, urgency, location, additional_notes, status)
           VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, 'active')
           RETURNING *`,
          [
            socket.user?.id, requestData.patientName, requestData.bloodType, 
            requestData.unitsNeeded, requestData.hospital, requestData.urgency,
            requestData.location.longitude, requestData.location.latitude, 
            requestData.additionalNotes
          ]
        );

        const savedRequest = result.rows[0];
        
        // Broadcast to all connected clients except sender
        socket.broadcast.emit('new-blood-request', {
          ...savedRequest,
          requester_name: socket.user?.email.split('@')[0]
        });
        
        // Confirm to sender
        socket.emit('request-created', { 
          status: 'success', 
          requestId: savedRequest.id,
          message: 'Blood request broadcasted to nearby donors'
        });

      } catch (error) {
        console.error('Error creating request:', error);
        socket.emit('request-error', { 
          message: 'Failed to create blood request' 
        });
      }
    });

    // Handle donor response to request
    socket.on('donor-response', async (responseData) => {
      const { requestId, message, availability } = responseData;
      const donorId = socket.user?.id;
      
      console.log(`Donor ${donorId} responded to request ${requestId}`);
      
      try {
        // Check if request exists and is active
        const requestCheck = await pool.query(
          'SELECT requester_id FROM blood_requests WHERE id = $1 AND status = $2',
          [requestId, 'active']
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('response-error', { message: 'Active request not found' });
          return;
        }

        const requesterId = requestCheck.rows[0].requester_id;

        // Save response to database
        const result = await pool.query(
          `INSERT INTO donor_responses (request_id, donor_id, message, availability, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING *`,
          [requestId, donorId, message, availability]
        );

        // Notify the requester
        io.to(`user:${requesterId}`).emit('donor-available', {
          requestId,
          donorId,
          donorName: socket.user?.email.split('@')[0],
          message,
          responseTime: new Date().toISOString(),
          responseId: result.rows[0].id
        });

        socket.emit('response-sent', {
          status: 'success',
          message: 'Response sent successfully'
        });

      } catch (error) {
        console.error('Error handling donor response:', error);
        socket.emit('response-error', { 
          message: 'Failed to send response' 
        });
      }
    });

    // ==================== CHAT HANDLERS ====================

    // Join conversation room
    socket.on('join-conversation', async (data: {
      conversationId: string;
      userId: string;
      requestId: string;
    }) => {
      const { conversationId, userId, requestId } = data;
      const userIdNum = parseInt(userId);
      
      if (socket.user?.id !== userIdNum) {
        socket.emit('join-error', { error: 'Unauthorized join attempt' });
        return;
      }

      try {
        // Join the room
        await socket.join(conversationId);
        console.log(`User ${userId} joined conversation ${conversationId}`);
        
        // Load chat history from database
        const chatHistory = await getChatHistory(conversationId);
        socket.emit('chat-history', chatHistory);
        
        // Confirm join
        socket.emit('conversation-joined', {
          conversationId,
          requestId,
          userId
        });
        
        // Notify others in the room
        socket.to(conversationId).emit('user-joined', {
          userId,
          userName: socket.user?.email.split('@')[0],
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('Error joining conversation:', error);
        socket.emit('join-error', { error: 'Failed to join conversation' });
      }
    });

    // Handle sending messages
    socket.on('send-message', async (messageData: {
      conversationId: string;
      message: string;
      senderId: string;
      senderType: 'donor' | 'requester';
      requestId: string;
      timestamp: string;
    }) => {
      const { conversationId, message, senderId, senderType, requestId, timestamp } = messageData;
      const senderIdNum = parseInt(senderId);
      
      if (socket.user?.id !== senderIdNum) {
        socket.emit('message-error', { error: 'Unauthorized message send attempt' });
        return;
      }

      try {
        // Save message to database
        const savedMessage = await saveMessage({
          conversationId,
          text: message,
          senderId: senderIdNum,
          senderType,
          requestId: parseInt(requestId),
          timestamp: new Date(timestamp)
        });
        
        // Broadcast to all in the conversation room
        io.to(conversationId).emit('new-message', {
          messageId: savedMessage.id,
          conversationId,
          message: savedMessage.text,
          senderId: savedMessage.sender_id, // Use database column name
          senderType: savedMessage.sender_type, // Use database column name
          requestId: savedMessage.request_id, // Use database column name
          timestamp: savedMessage.timestamp,
          read: savedMessage.read_status
        });
        
        console.log(`💬 Message sent in ${conversationId} by ${senderId}`);
        
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('message-error', { error: 'Failed to send message' });
      }
    });

    // Handle marking messages as read
    socket.on('mark-messages-read', async (data: { messageIds: string[] }) => {
      const { messageIds } = data;
      
      try {
        await markMessagesAsRead(messageIds);
        
        // Notify other participants in the conversation
        const conversations = await getConversationsForMessages(messageIds);
        conversations.forEach(conversationId => {
          socket.to(conversationId).emit('messages-read', { messageIds });
        });
        
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // Handle typing indicators
    socket.on('typing-start', (data: { conversationId: string; userId: string }) => {
      const userIdNum = parseInt(data.userId);
      if (socket.user?.id !== userIdNum) {
        return;
      }
      
      socket.to(data.conversationId).emit('user-typing', {
        userId: data.userId,
        userName: socket.user?.email.split('@')[0],
        isTyping: true
      });
    });

    socket.on('typing-stop', (data: { conversationId: string; userId: string }) => {
      const userIdNum = parseInt(data.userId);
      if (socket.user?.id !== userIdNum) {
        return;
      }
      
      socket.to(data.conversationId).emit('user-typing', {
        userId: data.userId,
        userName: socket.user?.email.split('@')[0],
        isTyping: false
      });
    });

    // Handle location updates
    socket.on('update-location', async (locationData) => {
      const { latitude, longitude } = locationData;
      const userId = socket.user?.id;
      
      console.log(`Location update from user ${userId}`);
      
      try {
        await pool.query(
          `UPDATE users 
           SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326), updated_at = NOW()
           WHERE id = $3`,
          [longitude, latitude, userId]
        );
        
        // Broadcast to relevant users
        socket.broadcast.emit('location-updated', {
          userId,
          location: { latitude, longitude },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Error updating location:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log('🔌 Client disconnected:', socket.id, 'User:', socket.user?.email, 'Reason:', reason);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  console.log('✅ Socket.io handlers setup complete');
};

// Database functions for chat
const getChatHistory = async (conversationId: string): Promise<any[]> => {
  try {
    const result = await pool.query(
      `SELECT 
        id, conversation_id, text, sender_id, sender_type, request_id,
        timestamp, read_status, created_at
       FROM chat_messages 
       WHERE conversation_id = $1 
       ORDER BY timestamp ASC
       LIMIT 100`,
      [conversationId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return [];
  }
};

const saveMessage = async (messageData: any): Promise<any> => {
  try {
    const result = await pool.query(
      `INSERT INTO chat_messages 
       (conversation_id, text, sender_id, sender_type, request_id, timestamp, read_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        messageData.conversationId,
        messageData.text,
        messageData.senderId,
        messageData.senderType,
        messageData.requestId,
        messageData.timestamp,
        false
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
};

const markMessagesAsRead = async (messageIds: string[]): Promise<void> => {
  try {
    await pool.query(
      `UPDATE chat_messages 
       SET read_status = true, read_at = NOW()
       WHERE id = ANY($1)`,
      [messageIds]
    );
  } catch (error) {
    console.error('Error marking messages as read:', error);
    throw error;
  }
};

const getConversationsForMessages = async (messageIds: string[]): Promise<string[]> => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT conversation_id FROM chat_messages WHERE id = ANY($1)',
      [messageIds]
    );
    return result.rows.map(row => row.conversation_id);
  } catch (error) {
    console.error('Error getting conversations for messages:', error);
    return [];
  }
};