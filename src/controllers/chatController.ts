import { Request, Response } from 'express';
import { pool } from '../config/database';
import { AuthenticatedRequest } from '../types/express';

interface SendMessageRequest {
  conversationId: string;
  text: string;
  requestId: string;
}

interface MarkMessagesReadRequest {
  messageIds: string[];
}

export const chatController = {
  // Get conversation by request ID
  getConversationByRequestId: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const userId = req.user?.id;
      
      console.log("Request ID:", requestId);
      console.log("User ID:", userId);

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      if (!requestId) {
        res.status(400).json({
          status: 'error',
          message: 'Request ID is required'
        });
        return;
      }

      // Verify user has access to this request
      const requestCheck = await pool.query(
        `SELECT id, requester_id FROM blood_requests 
         WHERE id = $1 AND (requester_id = $2 OR id IN (
           SELECT request_id FROM donor_responses WHERE donor_id = $2
         ))`,
        [requestId, userId]
      );

      if (requestCheck.rows.length === 0) {
        res.status(403).json({
          status: 'error',
          message: 'Access denied to this conversation'
        });
        return;
      }

      const conversationId = `request_${requestId}`;

      // Get messages with sender information
      const messagesResult = await pool.query(
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
         ORDER BY cm.timestamp ASC`,
        [conversationId]
      );

      // Get request details for the conversation
      const requestResult = await pool.query(
        `SELECT 
          br.patient_name,
          br.hospital,
          br.blood_type,
          br.urgency,
          br.status as request_status,
          u.name as requester_name
         FROM blood_requests br
         JOIN users u ON br.requester_id = u.id
         WHERE br.id = $1`,
        [requestId]
      );

      const requestDetails = requestResult.rows[0] || {};

      // Format messages for frontend
      const messages = messagesResult.rows.map(message => ({
        id: message.id,
        conversationId: message.conversation_id,
        text: message.text,
        senderId: message.sender_id,
        senderType: message.sender_type,
        senderName: message.sender_name,
        senderBloodType: message.sender_blood_type,
        requestId: message.request_id,
        timestamp: message.timestamp,
        readStatus: message.read_status,
        readAt: message.read_at,
        createdAt: message.created_at
      }));

      res.status(200).json({
        status: 'success',
        data: {
          conversationId,
          requestId,
          requestDetails,
          messages
        }
      });

    } catch (error) {
      console.error('Get conversation error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch conversation'
      });
    }
  },

  // Send message (REST API endpoint)
  sendMessage: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { conversationId, text, requestId }: SendMessageRequest = req.body;
      const senderId = req.user?.id;
      const senderType = req.user?.userType;

      if (!senderId || !senderType) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      if (!conversationId || !text || !requestId) {
        res.status(400).json({
          status: 'error',
          message: 'conversationId, text, and requestId are required'
        });
        return;
      }

      if (typeof text !== 'string' || text.trim().length === 0) {
        res.status(400).json({
          status: 'error',
          message: 'Text message cannot be empty'
        });
        return;
      }

      // Verify user has access to this conversation
      const accessCheck = await pool.query(
        `SELECT br.id 
         FROM blood_requests br
         WHERE br.id = $1 AND (br.requester_id = $2 OR br.id IN (
           SELECT request_id FROM donor_responses WHERE donor_id = $2
         ))`,
        [requestId, senderId]
      );

      if (accessCheck.rows.length === 0) {
        res.status(403).json({
          status: 'error',
          message: 'Access denied to this conversation'
        });
        return;
      }

      // Insert message
      const result = await pool.query(
        `INSERT INTO chat_messages 
         (conversation_id, text, sender_id, sender_type, request_id, timestamp, read_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          conversationId,
          text.trim(),
          senderId,
          senderType,
          requestId,
          new Date(),
          false
        ]
      );

      const savedMessage = result.rows[0];

      // Get sender info for response
      const senderResult = await pool.query(
        'SELECT name, blood_type FROM users WHERE id = $1',
        [senderId]
      );

      const senderInfo = senderResult.rows[0];

      const responseMessage = {
        id: savedMessage.id,
        conversationId: savedMessage.conversation_id,
        text: savedMessage.text,
        senderId: savedMessage.sender_id,
        senderType: savedMessage.sender_type,
        senderName: senderInfo?.name,
        senderBloodType: senderInfo?.blood_type,
        requestId: savedMessage.request_id,
        timestamp: savedMessage.timestamp,
        readStatus: savedMessage.read_status,
        createdAt: savedMessage.created_at
      };

      res.status(201).json({
        status: 'success',
        data: {
          message: responseMessage
        }
      });

    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to send message'
      });
    }
  },

  // Mark messages as read
  markMessagesAsRead: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { messageIds }: MarkMessagesReadRequest = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        res.status(400).json({
          status: 'error',
          message: 'messageIds array with at least one ID is required'
        });
        return;
      }

      // Validate message IDs
      const validMessageIds = messageIds.filter(id => 
        typeof id === 'string' && id.length > 0
      );

      if (validMessageIds.length === 0) {
        res.status(400).json({
          status: 'error',
          message: 'No valid message IDs provided'
        });
        return;
      }

      // Verify user has access to these messages
      const accessCheck = await pool.query(
        `SELECT cm.id 
         FROM chat_messages cm
         JOIN blood_requests br ON cm.request_id = br.id
         WHERE cm.id = ANY($1) AND (br.requester_id = $2 OR cm.sender_id = $2)`,
        [validMessageIds, userId]
      );

      if (accessCheck.rows.length !== validMessageIds.length) {
        res.status(403).json({
          status: 'error',
          message: 'Access denied to some messages'
        });
        return;
      }

      // Mark messages as read
      const updateResult = await pool.query(
        `UPDATE chat_messages 
         SET read_status = true, read_at = NOW()
         WHERE id = ANY($1)
         RETURNING id`,
        [validMessageIds]
      );

      res.status(200).json({
        status: 'success',
        message: 'Messages marked as read successfully',
        data: {
          markedCount: updateResult.rows.length,
          messageIds: updateResult.rows.map(row => row.id)
        }
      });

    } catch (error) {
      console.error('Mark messages read error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to mark messages as read'
      });
    }
  },

  // Get user conversations
  getUserConversations: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      const result = await pool.query(
        `SELECT DISTINCT 
          cm.conversation_id,
          cm.request_id,
          br.patient_name,
          br.hospital,
          br.blood_type,
          br.urgency,
          br.status as request_status,
          u.name as requester_name,
          COUNT(cm.id) as message_count,
          MAX(cm.timestamp) as last_message_time,
          SUM(CASE WHEN cm.read_status = false AND cm.sender_id != $1 THEN 1 ELSE 0 END) as unread_count,
          (
            SELECT cm2.text 
            FROM chat_messages cm2 
            WHERE cm2.conversation_id = cm.conversation_id 
            ORDER BY cm2.timestamp DESC 
            LIMIT 1
          ) as last_message_text
         FROM chat_messages cm
         LEFT JOIN blood_requests br ON cm.request_id = br.id
         LEFT JOIN users u ON br.requester_id = u.id
         WHERE cm.sender_id = $1 OR br.requester_id = $1
         GROUP BY cm.conversation_id, cm.request_id, br.patient_name, br.hospital, br.blood_type, br.urgency, br.status, u.name
         ORDER BY last_message_time DESC`,
        [userId]
      );

      const conversations = result.rows.map(conv => ({
        conversationId: conv.conversation_id,
        requestId: conv.request_id,
        patientName: conv.patient_name,
        hospital: conv.hospital,
        bloodType: conv.blood_type,
        urgency: conv.urgency,
        requestStatus: conv.request_status,
        requesterName: conv.requester_name,
        messageCount: parseInt(conv.message_count) || 0,
        unreadCount: parseInt(conv.unread_count) || 0,
        lastMessageTime: conv.last_message_time,
        lastMessageText: conv.last_message_text
      }));

      res.status(200).json({
        status: 'success',
        data: {
          conversations,
          total: conversations.length
        }
      });

    } catch (error) {
      console.error('Get conversations error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch conversations'
      });
    }
  },

  // Get unread message count for user
  getUnreadMessageCount: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      const result = await pool.query(
        `SELECT COUNT(*) as unread_count
         FROM chat_messages cm
         JOIN blood_requests br ON cm.request_id = br.id
         WHERE cm.read_status = false 
         AND cm.sender_id != $1
         AND (br.requester_id = $1 OR cm.sender_id IN (
           SELECT donor_id FROM donor_responses WHERE request_id = br.id AND donor_id = $1
         ))`,
        [userId]
      );

      const unreadCount = parseInt(result.rows[0]?.unread_count) || 0;

      res.status(200).json({
        status: 'success',
        data: {
          unreadCount
        }
      });

    } catch (error) {
      console.error('Get unread count error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch unread message count'
      });
    }
  },

  // Clear conversation (soft delete for user)
  clearConversation: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      if (!requestId) {
        res.status(400).json({
          status: 'error',
          message: 'Request ID is required'
        });
        return;
      }

      const conversationId = `request_${requestId}`;

      // Verify user has access to this conversation
      const accessCheck = await pool.query(
        `SELECT id FROM blood_requests 
         WHERE id = $1 AND (requester_id = $2 OR id IN (
           SELECT request_id FROM donor_responses WHERE donor_id = $2
         ))`,
        [requestId, userId]
      );

      if (accessCheck.rows.length === 0) {
        res.status(403).json({
          status: 'error',
          message: 'Access denied to this conversation'
        });
        return;
      }

      // Mark all messages as read for this user
      await pool.query(
        `UPDATE chat_messages 
         SET read_status = true, read_at = NOW()
         WHERE conversation_id = $1 AND sender_id != $2 AND read_status = false`,
        [conversationId, userId]
      );

      res.status(200).json({
        status: 'success',
        message: 'Conversation cleared successfully',
        data: {
          conversationId,
          requestId
        }
      });

    } catch (error) {
      console.error('Clear conversation error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to clear conversation'
      });
    }
  },

  // Search messages in conversation
  searchMessages: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const { query } = req.query;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated'
        });
        return;
      }

      if (!requestId) {
        res.status(400).json({
          status: 'error',
          message: 'Request ID is required'
        });
        return;
      }

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        res.status(400).json({
          status: 'error',
          message: 'Valid search query is required'
        });
        return;
      }

      const conversationId = `request_${requestId}`;

      // Verify user has access to this conversation
      const accessCheck = await pool.query(
        `SELECT id FROM blood_requests 
         WHERE id = $1 AND (requester_id = $2 OR id IN (
           SELECT request_id FROM donor_responses WHERE donor_id = $2
         ))`,
        [requestId, userId]
      );

      if (accessCheck.rows.length === 0) {
        res.status(403).json({
          status: 'error',
          message: 'Access denied to this conversation'
        });
        return;
      }

      // Search messages
      const searchResult = await pool.query(
        `SELECT 
          cm.id,
          cm.conversation_id,
          cm.text,
          cm.sender_id,
          cm.sender_type,
          cm.request_id,
          cm.timestamp,
          cm.read_status,
          u.name as sender_name
         FROM chat_messages cm
         LEFT JOIN users u ON cm.sender_id = u.id
         WHERE cm.conversation_id = $1 
         AND cm.text ILIKE $2
         ORDER BY cm.timestamp DESC`,
        [conversationId, `%${query.trim()}%`]
      );

      const messages = searchResult.rows.map(message => ({
        id: message.id,
        conversationId: message.conversation_id,
        text: message.text,
        senderId: message.sender_id,
        senderType: message.sender_type,
        senderName: message.sender_name,
        requestId: message.request_id,
        timestamp: message.timestamp,
        readStatus: message.read_status
      }));

      res.status(200).json({
        status: 'success',
        data: {
          query,
          results: messages,
          total: messages.length
        }
      });

    } catch (error) {
      console.error('Search messages error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to search messages'
      });
    }
  }
};