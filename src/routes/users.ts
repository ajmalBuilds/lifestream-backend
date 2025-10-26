import { Router } from 'express';
import { userController } from '../controllers/userController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Apply auth middleware to all user routes
router.use(authMiddleware);

// Profile management
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.get('/profile/donation-history', userController.getDonationHistory);

// Donor search and matching
router.get('/donors/nearby', userController.getNearbyDonors);
router.get('/donors/search', userController.searchDonors);
router.get('/donors/:donorId', userController.getDonorProfile);

// Location services
router.post('/location', userController.updateLocation);
router.get('/blood-banks/nearby', userController.getNearbyBloodBanks);

// Verification
router.post('/verify-donor', userController.verifyDonor);
router.get('/verification-status', userController.getVerificationStatus);

// Statistics
router.get('/stats', userController.getUserStats);

export const userRoutes = router;