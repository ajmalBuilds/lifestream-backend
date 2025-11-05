import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { chatController } from '../controllers/chatController';

const router = Router();

// Apply auth middleware to all chat routes
router.use(authMiddleware);

// Get conversation by request ID
router.get('/conversation/request/:requestId', chatController.getConversationByRequestId);

// Send message (REST fallback)
router.post('/messages', chatController.sendMessage);

// Mark messages as read
router.post('/messages/read', chatController.markMessagesAsRead);

// Get user conversations
router.get('/conversations', chatController.getUserConversations);

// Get unread message count
router.get('/unread-count', chatController.getUnreadMessageCount);

// Clear conversation (mark all as read)
router.post('/conversation/:requestId/clear', chatController.clearConversation);

// Search messages in conversation
router.get('/conversation/:requestId/search', chatController.searchMessages);

export const chatRoutes = router;