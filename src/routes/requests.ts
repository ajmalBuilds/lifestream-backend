import { Router } from 'express';
import { requestController } from '../controllers/requestController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Apply auth middleware to all request routes
router.use(authMiddleware);

// Blood request management
router.post('/create', requestController.createRequest);
router.get('/active', requestController.getActiveRequests);
router.get('/nearby', requestController.getNearbyRequests);
router.get('/:requestId', requestController.getRequestDetails);
router.put('/:requestId/status', requestController.updateRequestStatus);
router.delete('/:requestId', requestController.cancelRequest);

// Donor responses
router.post('/:requestId/respond', requestController.respondToRequest);
router.get('/:requestId/responses', requestController.getRequestResponses);
router.get('/:requestId/existing-response', requestController.existingRespondOnARequest);
router.post('/:requestId/select-donor', requestController.selectDonor);

// User request history
router.get('/user/history', requestController.getUserRequestHistory);
router.get('/user/donation-history', requestController.getUserDonationHistory);

// Emergency requests
router.post('/emergency', requestController.createEmergencyRequest);
router.get('/emergency/active', requestController.getActiveEmergencies);

export const requestRoutes = router;