import { Server as SocketIOServer, Socket } from 'socket.io';
import { pool } from '../config/database';

// Extend the Socket interface to include user property
interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    userType: string;
  };
}

export const setupChatHandlers = (io: SocketIOServer): void => {
  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('💬 Chat client connected:', socket.id, 'User:', socket.user?.email);

    // Join conversation room
    socket.on('join-conversation', async (data: {
      conversationId: string;
      userId: string;
      requestId: string;
    }) => {
      const { conversationId, userId, requestId } = data;
      
      if (socket.user?.id !== userId) {
        socket.emit('join-error', { error: 'Unauthorized join attempt' });
        return;
      }

      try {
        // Verify user has access to this conversation
        const accessCheck = await pool.query(
          `SELECT id FROM blood_requests 
           WHERE id = $1 AND (requester_id = $2 OR id IN (
             SELECT request_id FROM donor_responses WHERE donor_id = $2
           ))`,
          [requestId, userId]
        );

        if (accessCheck.rows.length === 0) {
          socket.emit('join-error', { error: 'Access denied to this conversation' });
          return;
        }

        // Join the room
        await socket.join(conversationId);
        console.log(`💬 User ${userId} joined conversation ${conversationId}`);

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
        console.error('❌ Error joining conversation:', error);
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
      const messageId = require('uuid').v4();
       
      if (socket.user?.id !== senderId) {
        socket.emit('message-error', { error: 'Unauthorized message send attempt' });
        return;
      }

      try {
        // Verify user has access to this conversation
        const accessCheck = await pool.query(
          `SELECT id FROM blood_requests 
           WHERE id = $1 AND (requester_id = $2 OR id IN (
             SELECT request_id FROM donor_responses WHERE donor_id = $2
           ))`,
          [requestId, senderId]
        );

        if (accessCheck.rows.length === 0) {
          socket.emit('message-error', { error: 'Access denied to this conversation' });
          return;
        }

        // Save message to database
        const savedMessage = await saveMessage({
          id: messageId,
          conversationId,
          text: message,
          senderId: senderId,
          senderType,
          requestId: requestId,
          timestamp: new Date(timestamp)
        });

        // Broadcast to all in the conversation room
        io.to(conversationId).emit('new-message', {
          messageId: savedMessage.id,
          conversationId,
          message: savedMessage.text,
          senderId: savedMessage.sender_id,
          senderType: savedMessage.sender_type,
          requestId: savedMessage.request_id,
          timestamp: savedMessage.timestamp,
          read: savedMessage.read_status
        });

        console.log(`💬 Message sent in ${conversationId} by ${senderId}`);

      } catch (error) {
        console.error('❌ Error sending message:', error);
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
        console.error('❌ Error marking messages as read:', error);
      }
    });

    // Handle typing indicators
    socket.on('typing-start', (data: { conversationId: string; userId: string }) => {
      const { conversationId, userId } = data;
      
      if (socket.user?.id !== userId) {
        return;
      }
      
      socket.to(conversationId).emit('user-typing', {
        userId,
        userName: socket.user?.email.split('@')[0],
        isTyping: true
      });
    });

    socket.on('typing-stop', (data: { conversationId: string; userId: string }) => {
      const { conversationId, userId } = data;
      
      if (socket.user?.id !== userId) {
        return;
      }
      
      socket.to(conversationId).emit('user-typing', {
        userId,
        userName: socket.user?.email.split('@')[0],
        isTyping: false
      });
    });

    // Handle read receipts for specific messages
    socket.on('message-read', async (data: { messageId: string; conversationId: string }) => {
      const { messageId, conversationId } = data;
      const userId = socket.user?.id;

      try {
        if (!userId) return;

        // Mark single message as read
        await pool.query(
          `UPDATE chat_messages 
           SET read_status = true, read_at = NOW()
           WHERE id = $1 AND sender_id != $2`,
          [messageId, userId]
        );

        // Notify sender that their message was read
        socket.to(conversationId).emit('message-read-receipt', {
          messageId,
          readBy: userId,
          readAt: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error marking message as read:', error);
      }
    });

    // Handle conversation leave
    socket.on('leave-conversation', (data: { conversationId: string; userId: string }) => {
      const { conversationId, userId } = data;
      
      if (socket.user?.id !== userId) {
        return;
      }

      socket.leave(conversationId);
      console.log(`💬 User ${userId} left conversation ${conversationId}`);

      socket.to(conversationId).emit('user-left', {
        userId,
        userName: socket.user?.email.split('@')[0],
        timestamp: new Date().toISOString()
      });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log('💬 Chat client disconnected:', socket.id, 'User:', socket.user?.email, 'Reason:', reason);
    });
  });

  console.log('✅ Chat socket handlers setup complete');
};

// Database helper functions for chat
const getChatHistory = async (conversationId: string): Promise<any[]> => {
  try {
    const result = await pool.query(
      `SELECT 
        cm.id,
        cm.conversation_id,
        cm.text,
        cm.sender_id,
        cm.sender_type,
        cm.request_id,
        cm.timestamp,
        cm.read_status,
        cm.read_at,
        cm.created_at,
        u.name as sender_name,
        u.blood_type as sender_blood_type
       FROM chat_messages cm
       LEFT JOIN users u ON cm.sender_id = u.id
       WHERE cm.conversation_id = $1 
       ORDER BY cm.timestamp ASC
       LIMIT 100`,
      [conversationId]
    );
    return result.rows;
  } catch (error) {
    console.error('❌ Error fetching chat history:', error);
    return [];
  }
};

const saveMessage = async (messageData: any): Promise<any> => {
  try {
    const result = await pool.query(
      `INSERT INTO chat_messages 
       (id, conversation_id, text, sender_id, sender_type, request_id, timestamp, read_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        messageData.id,
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
    console.error('❌ Error saving message:', error);
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
    console.error('❌ Error marking messages as read:', error);
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
    console.error('❌ Error getting conversations for messages:', error);
    return [];
  }
};