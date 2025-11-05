import { Request, Response } from 'express';
import { pool } from '../config/database';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    userType: string;
  };
}

export const userController = {
  // Get user profile
  getProfile: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      
      const result = await pool.query(
        `SELECT 
          id, email, name, blood_type, user_type, phone, 
          location, date_of_birth, gender, is_verified,
          created_at, updated_at
         FROM users 
         WHERE id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'User not found',
        });
        return;
      }

      res.status(200).json({
        status: 'success',
        data: {
          user: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch profile',
      });
    }
  },

  // Update user profile
  updateProfile: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { name, phone, dateOfBirth, gender, bloodType, location } = req.body;
  
      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated',
        });
        return;
      }
  
      // First, get the current user to preserve existing blood_type if not provided
      const currentUser = await pool.query(
        'SELECT blood_type FROM users WHERE id = $1',
        [userId]
      );
  
      if (currentUser.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'User not found',
        });
        return;
      }
  
      const currentBloodType = currentUser.rows[0].blood_type;
  
      // Use provided bloodType or keep the current one
      const finalBloodType = bloodType !== undefined && bloodType !== null ? bloodType : currentBloodType;
  
      // Build the update query dynamically to handle location
      let query = `
        UPDATE users 
        SET name = $1, phone = $2, date_of_birth = $3, gender = $4, blood_type = $5, updated_at = NOW()
      `;
      
      const params: any[] = [name, phone, dateOfBirth, gender, finalBloodType];
      let paramCount = 5;
  
      // Add location update if provided
      if (location && location.latitude && location.longitude) {
        query += `, location = ST_SetSRID(ST_MakePoint($${++paramCount}, $${++paramCount}), 4326)`;
        params.push(location.longitude, location.latitude);
      }
  
      query += ` WHERE id = $${++paramCount} RETURNING id, name, email, blood_type, phone, date_of_birth, gender, is_verified`;
      params.push(userId);
  
      const result = await pool.query(query, params);
  
      res.status(200).json({
        status: 'success',
        message: 'Profile updated successfully',
        data: {
          user: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update profile',
      });
    }
  },

  // Get donation history
  getDonationHistory: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      const result = await pool.query(
        `SELECT 
          d.id, d.donation_date, d.status, d.units_donated,
          br.patient_name, br.blood_type, br.hospital,
          u.name as recipient_name
         FROM donations d
         LEFT JOIN blood_requests br ON d.request_id = br.id
         LEFT JOIN users u ON br.requester_id = u.id
         WHERE d.donor_id = $1
         ORDER BY d.donation_date DESC`,
        [userId]
      );

      res.status(200).json({
        status: 'success',
        data: {
          donations: result.rows,
        },
      });
    } catch (error) {
      console.error('Get donation history error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch donation history',
      });
    }
  },

  // Get nearby donors
  getNearbyDonors: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { latitude, longitude, radius = 10, bloodType } = req.query;
      const userId = req.user?.id;

      if (!latitude || !longitude) {
        res.status(400).json({
          status: 'error',
          message: 'Latitude and longitude are required',
        });
        return;
      }

      const query = `
        SELECT 
          id, name, blood_type, 
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude,
          phone, is_verified,
          ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance
        FROM users 
        WHERE user_type = 'donor' 
          AND id != $3
          AND is_verified = true
          AND ($4::text IS NULL OR blood_type = $4::text)
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $5 * 1000)
        ORDER BY distance
        LIMIT 50
      `;

      const result = await pool.query(query, [
        longitude, latitude, userId, bloodType, radius
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          donors: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get nearby donors error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch nearby donors',
      });
    }
  },

  // Search donors
  searchDonors: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { bloodType, location, maxDistance = 20 } = req.query;
      const userId = req.user?.id;

      let query = `
        SELECT 
          id, name, blood_type, phone, is_verified,
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude
        FROM users 
        WHERE user_type = 'donor' 
          AND id != $1
          AND is_verified = true
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      if (bloodType) {
        paramCount++;
        query += ` AND blood_type = $${paramCount}`;
        params.push(bloodType);
      }

      query += ' ORDER BY created_at DESC LIMIT 100';

      const result = await pool.query(query, params);

      res.status(200).json({
        status: 'success',
        data: {
          donors: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Search donors error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to search donors',
      });
    }
  },

  // Get donor profile
  getDonorProfile: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { donorId } = req.params;

      const result = await pool.query(
        `SELECT 
          id, name, blood_type, 
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude,
          is_verified, created_at,
          (SELECT COUNT(*) FROM donations WHERE donor_id = $1 AND status = 'completed') as total_donations
         FROM users 
         WHERE id = $1 AND user_type = 'donor'`,
        [donorId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Donor not found',
        });
        return;
      }

      res.status(200).json({
        status: 'success',
        data: {
          donor: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Get donor profile error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch donor profile',
      });
    }
  },

  // Update user location
  updateLocation: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        res.status(400).json({
          status: 'error',
          message: 'Latitude and longitude are required',
        });
        return;
      }

      await pool.query(
        `UPDATE users 
         SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326), updated_at = NOW()
         WHERE id = $3`,
        [longitude, latitude, userId]
      );

      res.status(200).json({
        status: 'success',
        message: 'Location updated successfully',
      });
    } catch (error) {
      console.error('Update location error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update location',
      });
    }
  },

  // Get nearby blood banks
  getNearbyBloodBanks: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { latitude, longitude, radius = 20 } = req.query;

      if (!latitude || !longitude) {
        res.status(400).json({
          status: 'error',
          message: 'Latitude and longitude are required',
        });
        return;
      }

      const result = await pool.query(
        `SELECT 
          id, name, address, phone, email,
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude,
          inventory, operating_hours,
          ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance
         FROM blood_banks 
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)
         ORDER BY distance
         LIMIT 20`,
        [longitude, latitude, radius]
      );

      res.status(200).json({
        status: 'success',
        data: {
          bloodBanks: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get nearby blood banks error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch nearby blood banks',
      });
    }
  },

  // Verify donor
  verifyDonor: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { documentUrl } = req.body;

      // In real implementation, you'd process verification
      await pool.query(
        'UPDATE users SET verification_status = $1, document_url = $2 WHERE id = $3',
        ['pending', documentUrl, userId]
      );

      res.status(200).json({
        status: 'success',
        message: 'Verification submitted successfully',
      });
    } catch (error) {
      console.error('Verify donor error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to submit verification',
      });
    }
  },

  // Get verification status
  getVerificationStatus: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      const result = await pool.query(
        'SELECT verification_status, is_verified FROM users WHERE id = $1',
        [userId]
      );

      res.status(200).json({
        status: 'success',
        data: {
          verification: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Get verification status error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch verification status',
      });
    }
  },

  // Get user statistics
  getUserStats: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      const statsResult = await pool.query(
        `SELECT 
          (SELECT COUNT(*) FROM blood_requests WHERE requester_id = $1) as total_requests,
          (SELECT COUNT(*) FROM donations WHERE donor_id = $1 AND status = 'completed') as total_donations,
          (SELECT COUNT(*) FROM blood_requests WHERE requester_id = $1 AND status = 'fulfilled') as fulfilled_requests
        `,
        [userId]
      );

      res.status(200).json({
        status: 'success',
        data: {
          stats: statsResult.rows[0],
        },
      });
    } catch (error) {
      console.error('Get user stats error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch user statistics',
      });
    }
  },
};