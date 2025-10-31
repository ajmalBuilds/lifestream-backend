import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { pool } from '../config/database';

const router = Router();

// Apply auth middleware to all chat routes
router.use(authMiddleware);

// Get conversation by request ID
router.get('/conversation/request/:requestId', async (req: any, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    // Verify user has access to this request
    const requestCheck = await pool.query(
      `SELECT id FROM blood_requests 
       WHERE id = $1 AND (requester_id = $2 OR id IN (
         SELECT request_id FROM donor_responses WHERE donor_id = $2
       ))`,
      [parseInt(requestId), userId]
    );

    if (requestCheck.rows.length === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied to this conversation'
      });
    }

    const conversationId = `request_${requestId}`;

    // Get messages
    const messagesResult = await pool.query(
      `SELECT 
        cm.*,
        u.name as sender_name
       FROM chat_messages cm
       LEFT JOIN users u ON cm.sender_id = u.id
       WHERE cm.conversation_id = $1
       ORDER BY cm.timestamp ASC`,
      [conversationId]
    );

    res.status(200).json({
      status: 'success',
      data: {
        conversationId,
        requestId,
        messages: messagesResult.rows
      }
    });

  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch conversation'
    });
  }
});

// Send message (REST fallback)
router.post('/messages', async (req: any, res) => {
  try {
    const { conversationId, text, requestId } = req.body;
    const senderId = req.user.id;
    const senderType = req.user.userType;

    if (!conversationId || !text) {
      return res.status(400).json({
        status: 'error',
        message: 'conversationId and text are required'
      });
    }

    const result = await pool.query(
      `INSERT INTO chat_messages 
       (conversation_id, text, sender_id, sender_type, request_id, timestamp, read_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        conversationId,
        text,
        senderId,
        senderType,
        parseInt(requestId),
        new Date(),
        false
      ]
    );

    res.status(201).json({
      status: 'success',
      data: {
        message: result.rows[0]
      }
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send message'
    });
  }
});

// Mark messages as read
router.post('/messages/read', async (req: any, res) => {
  try {
    const { messageIds } = req.body;

    if (!messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({
        status: 'error',
        message: 'messageIds array is required'
      });
    }

    await pool.query(
      `UPDATE chat_messages 
       SET read_status = true, read_at = NOW()
       WHERE id = ANY($1)`,
      [messageIds]
    );

    res.status(200).json({
      status: 'success',
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Mark messages read error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark messages as read'
    });
  }
});

// Get user conversations
router.get('/conversations', async (req: any, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT DISTINCT 
        cm.conversation_id,
        cm.request_id,
        br.patient_name,
        br.hospital,
        br.blood_type,
        MAX(cm.timestamp) as last_message_time
       FROM chat_messages cm
       LEFT JOIN blood_requests br ON cm.request_id = br.id
       WHERE cm.sender_id = $1 OR br.requester_id = $1
       GROUP BY cm.conversation_id, cm.request_id, br.patient_name, br.hospital, br.blood_type
       ORDER BY last_message_time DESC`,
      [userId]
    );

    res.status(200).json({
      status: 'success',
      data: {
        conversations: result.rows
      }
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch conversations'
    });
  }
});

export const chatRoutes = router;