import { Server as SocketIOServer, Socket } from 'socket.io';
import { pool } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// Extend the Socket interface to include user property
interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    userType: string;
  };
}

interface JoinConversationData {
  conversationId: string;
  userId: string;
  requestId: string;
  userType?: string;
}

interface SendMessageData {
  conversationId: string;
  message: string;
  senderId: string;
  senderType: 'donor' | 'requester' | 'admin';
  requestId: string;
  timestamp: string;
  senderName?: string;
  senderBloodType?: string;
}

interface MarkMessagesReadData {
  messageIds: string[];
}

interface TypingData {
  conversationId: string;
  userId: string;
}

interface MessageReadData {
  messageId: string;
  conversationId: string;
}

export const setupChatHandlers = (io: SocketIOServer): void => {
  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('Chat client connected:', socket.id, 'User:', socket.user?.email);

    // Join conversation room
    socket.on('join-conversation', async (data: JoinConversationData) => {
      const { conversationId, userId, requestId } = data;
      
      console.log('Join conversation request:', { conversationId, userId, requestId });

      if (socket.user?.id !== userId) {
        console.error('Unauthorized join attempt:', { socketUserId: socket.user?.id, requestUserId: userId });
        socket.emit('join-error', { error: 'Unauthorized join attempt' });
        return;
      }

      try {
        // Verify user has access to this conversation
        const accessCheck = await pool.query(
          `SELECT br.id 
           FROM blood_requests br
           WHERE br.id = $1 
           AND (
             -- User is the requester (person needing blood)
             br.requester_id = $2 
             OR 
             -- User is a donor who has responded to this request
             EXISTS (
               SELECT 1 FROM donor_responses dr 
               WHERE dr.request_id = br.id 
               AND dr.donor_id = $2
               AND dr.status IN ('accepted', 'pending', 'completed')
             )
           )`,
          [requestId, userId]
        );

        if (accessCheck.rows.length === 0) {
          console.error('Access denied to conversation:', { requestId, userId });
          socket.emit('join-error', { error: 'Access denied to this conversation' });
          return;
        }

        // Join the room
        await socket.join(conversationId);
        console.log(`User ${userId} joined conversation ${conversationId}`);

        // Load chat history from database
        const chatHistory = await getChatHistory(conversationId);
        socket.emit('chat-history', chatHistory);

        // Get user info for notification
        const userResult = await pool.query(
          'SELECT name FROM users WHERE id = $1',
          [userId]
        );
        const userName = userResult.rows[0]?.name || socket.user?.email.split('@')[0];

        // Confirm join
        socket.emit('conversation-joined', {
          conversationId,
          requestId,
          userId,
          userName
        });

        // Notify others in the room
        socket.to(conversationId).emit('user-joined', {
          userId,
          userName,
          userType: socket.user?.userType,
          timestamp: new Date().toISOString()
        });

        console.log(`User ${userName} successfully joined conversation ${conversationId}`);

      } catch (error) {
        console.error('Error joining conversation:', error);
        socket.emit('join-error', { 
          error: error instanceof Error ? error.message : 'Failed to join conversation' 
        });
      }
    });

    // Handle sending messages
    socket.on('send-message', async (messageData: SendMessageData) => {
      const { conversationId, message, senderId, senderType, requestId, timestamp, senderName, senderBloodType } = messageData;
      
      console.log('Send message request:', { 
        conversationId, 
        senderId, 
        requestId,
        messageLength: message?.length 
      });

      if (socket.user?.id !== senderId) {
        console.error('Unauthorized message send attempt:', { socketUserId: socket.user?.id, messageSenderId: senderId });
        socket.emit('message-error', { error: 'Unauthorized message send attempt' });
        return;
      }

      if (!message?.trim()) {
        console.error('Empty message received');
        socket.emit('message-error', { error: 'Message cannot be empty' });
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
          console.error('Access denied to conversation for message:', { requestId, senderId });
          socket.emit('message-error', { error: 'Access denied to this conversation' });
          return;
        }

        const messageId = uuidv4();
        const messageTimestamp = new Date(timestamp || Date.now());

        // Save message to database
        const savedMessage = await saveMessage({
          id: messageId,
          conversationId,
          text: message.trim(),
          senderId: senderId,
          senderType,
          requestId: requestId,
          timestamp: messageTimestamp
        });

        // Get sender info if not provided
        let finalSenderName = senderName;
        let finalSenderBloodType = senderBloodType;
        
        if (!finalSenderName || !finalSenderBloodType) {
          const userResult = await pool.query(
            'SELECT name, blood_type FROM users WHERE id = $1',
            [senderId]
          );
          if (userResult.rows[0]) {
            finalSenderName = finalSenderName || userResult.rows[0].name;
            finalSenderBloodType = finalSenderBloodType || userResult.rows[0].blood_type;
          }
        }

        // Broadcast to all in the conversation room
        const messagePayload = {
          id: savedMessage.id,
          conversationId,
          text: savedMessage.text,
          senderId: savedMessage.sender_id,
          senderType: savedMessage.sender_type,
          senderName: finalSenderName,
          senderBloodType: finalSenderBloodType,
          requestId: savedMessage.request_id,
          timestamp: savedMessage.timestamp,
          readStatus: savedMessage.read_status,
          readAt: savedMessage.read_at
        };

        io.to(conversationId).emit('new-message', messagePayload);
        console.log(`Message sent in ${conversationId} by ${senderId} (${finalSenderName})`);

      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('message-error', { 
          error: error instanceof Error ? error.message : 'Failed to send message' 
        });
      }
    });

    // Handle marking messages as read
    socket.on('mark-messages-read', async (data: MarkMessagesReadData) => {
      const { messageIds } = data;
      
      console.log('Mark messages as read:', { messageIds });

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        console.error('Invalid message IDs for mark as read');
        return;
      }

      try {
        await markMessagesAsRead(messageIds);

        // Notify other participants in the conversation
        const conversations = await getConversationsForMessages(messageIds);
        conversations.forEach(conversationId => {
          socket.to(conversationId).emit('messages-read', { messageIds });
        });

        console.log(`Marked ${messageIds.length} messages as read`);

      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // Handle typing indicators
    socket.on('typing-start', (data: TypingData) => {
      const { conversationId, userId } = data;
      
      console.log('Typing start:', { conversationId, userId });

      if (socket.user?.id !== userId) {
        return;
      }
      
      // Get user info for typing indicator
      const userName = socket.user?.email.split('@')[0];
      
      socket.to(conversationId).emit('user-typing', {
        userId,
        userName,
        isTyping: true,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('typing-stop', (data: TypingData) => {
      const { conversationId, userId } = data;
      
      console.log('Typing stop:', { conversationId, userId });

      if (socket.user?.id !== userId) {
        return;
      }
      
      const userName = socket.user?.email.split('@')[0];
      
      socket.to(conversationId).emit('user-typing', {
        userId,
        userName,
        isTyping: false,
        timestamp: new Date().toISOString()
      });
    });

    // Handle read receipts for specific messages
    socket.on('message-read', async (data: MessageReadData) => {
      const { messageId, conversationId } = data;
      const userId = socket.user?.id;

      console.log('Message read receipt:', { messageId, conversationId, userId });

      try {
        if (!userId) {
          console.error('No user ID for message read receipt');
          return;
        }

        // Mark single message as read
        const result = await pool.query(
          `UPDATE chat_messages 
           SET read_status = true, read_at = NOW()
           WHERE id = $1 AND sender_id != $2
           RETURNING sender_id`,
          [messageId, userId]
        );

        if (result.rows.length > 0) {
          const senderId = result.rows[0].sender_id;
          
          // Notify sender that their message was read
          io.to(`user:${senderId}`).emit('message-read-receipt', {
            messageId,
            readBy: userId,
            readAt: new Date().toISOString(),
            conversationId
          });
        }

        console.log(`Message ${messageId} marked as read by ${userId}`);

      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    });

    // Handle conversation leave
    socket.on('leave-conversation', (data: { conversationId: string; userId: string }) => {
      const { conversationId, userId } = data;
      
      console.log('Leave conversation:', { conversationId, userId });

      if (socket.user?.id !== userId) {
        return;
      }

      socket.leave(conversationId);
      
      const userName = socket.user?.email.split('@')[0];
      console.log(`User ${userName} left conversation ${conversationId}`);

      socket.to(conversationId).emit('user-left', {
        userId,
        userName,
        timestamp: new Date().toISOString()
      });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log('Chat client disconnected:', socket.id, 'User:', socket.user?.email, 'Reason:', reason);
    });

    // Error handling for chat events
    socket.on('error', (error) => {
      console.error('Chat socket error:', error);
    });
  });

  console.log('Chat socket handlers setup complete');
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
       LIMIT 200`, // Increased limit for better history later
      [conversationId]
    );
    
    console.log(`Loaded ${result.rows.length} messages for conversation ${conversationId}`);
    return result.rows;
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return [];
  }
};

const saveMessage = async (messageData: {
  id: string;
  conversationId: string;
  text: string;
  senderId: string;
  senderType: string;
  requestId: string;
  timestamp: Date;
}): Promise<any> => {
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
    
    console.log(`Message saved to database: ${messageData.id}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
};

const markMessagesAsRead = async (messageIds: string[]): Promise<void> => {
  try {
    const result = await pool.query(
      `UPDATE chat_messages 
       SET read_status = true, read_at = NOW()
       WHERE id = ANY($1)
       RETURNING id`,
      [messageIds]
    );
    
    console.log(`Marked ${result.rows.length} messages as read`);
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
    
    const conversations = result.rows.map(row => row.conversation_id);
    console.log(`Found ${conversations.length} conversations for messages`);
    return conversations;
  } catch (error) {
    console.error('Error getting conversations for messages:', error);
    return [];
  }
};