import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { AuthenticatedRequest } from '../types/express';

export const requestController = {
  // Create blood request
  createRequest: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const requestId = uuidv4();
      const {
        patientName,
        bloodType,
        unitsNeeded,
        hospital,
        urgency,
        location,
        additionalNotes
      } = req.body;

      if (!patientName || !bloodType || !unitsNeeded || !hospital) {
        res.status(400).json({
          status: 'error',
          message: 'Missing required fields: patientName, bloodType, unitsNeeded, hospital',
        });
        return;
      }

      const result = await pool.query(
        `INSERT INTO blood_requests 
         (id, requester_id, patient_name, blood_type, units_needed, hospital, urgency, location, additional_notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, 'active')
         RETURNING *`,
        [
          requestId, userId, patientName, bloodType, unitsNeeded, hospital, urgency,
          location.longitude, location.latitude, additionalNotes
        ]
      );

      // Emit real-time event to nearby donors
      // This would be handled by Socket.io in a real implementation

      res.status(201).json({
        status: 'success',
        message: 'Blood request created successfully',
        data: {
          request: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Create request error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to create blood request',
      });
    }
  },

  // Get active requests
  getActiveRequests: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { bloodType, urgency, limit = 20, offset = 0 } = req.query;

      let query = `
        SELECT 
          br.*,
          u.name as requester_name,
          u.phone as requester_phone,
          ST_X(br.location::geometry) as longitude, 
          ST_Y(br.location::geometry) as latitude
        FROM blood_requests br
        JOIN users u ON br.requester_id = u.id
        WHERE br.status = 'active'
      `;

      const params: any[] = [];
      let paramCount = 0;

      if (bloodType) {
        paramCount++;
        query += ` AND br.blood_type = $${paramCount}`;
        params.push(bloodType);
      }

      if (urgency) {
        paramCount++;
        query += ` AND br.urgency = $${paramCount}`;
        params.push(urgency);
      }

      query += ` ORDER BY 
        CASE urgency 
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END, br.created_at DESC
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;

      params.push(limit, offset);

      const result = await pool.query(query, params);

      res.status(200).json({
        status: 'success',
        data: {
          requests: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get active requests error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch active requests',
      });
    }
  },

  // Get nearby requests
  getNearbyRequests: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
          br.*,
          u.name as requester_name,
          u.phone as requester_phone,
          ST_X(br.location::geometry) as longitude, 
          ST_Y(br.location::geometry) as latitude,
          ST_Distance(br.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance
        FROM blood_requests br
        JOIN users u ON br.requester_id = u.id
        WHERE br.status = 'active'
          AND br.requester_id != $3
          AND ($4::text IS NULL OR br.blood_type = $4::text)
          AND ST_DWithin(br.location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $5 * 1000)
        ORDER BY 
          CASE urgency 
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
          END,
          distance
        LIMIT 50
      `;

      const result = await pool.query(query, [
        longitude, latitude, userId, bloodType, radius
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          requests: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get nearby requests error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch nearby requests',
      });
    }
  },

  // Get request details
  getRequestDetails: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;

      const requestResult = await pool.query(
        `SELECT 
          br.*,
          u.name as requester_name,
          u.phone as requester_phone,
          ST_X(br.location::geometry) as longitude, 
          ST_Y(br.location::geometry) as latitude
         FROM blood_requests br
         JOIN users u ON br.requester_id = u.id
         WHERE br.id = $1`,
        [requestId]
      );

      if (requestResult.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Request not found',
        });
        return;
      }

      const responsesResult = await pool.query(
        `SELECT 
          dr.*,
          u.name as donor_name,
          u.blood_type as donor_blood_type,
          u.phone as donor_phone
         FROM donor_responses dr
         JOIN users u ON dr.donor_id = u.id
         WHERE dr.request_id = $1
         ORDER BY dr.created_at DESC`,
        [requestId]
      );

      res.status(200).json({
        status: 'success',
        data: {
          request: requestResult.rows[0],
          responses: responsesResult.rows,
        },
      });
    } catch (error) {
      console.error('Get request details error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch request details',
      });
    }
  },

  // Update request status
  updateRequestStatus: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { requestId } = req.params;
      const { status } = req.body;

      const validStatuses = ['active', 'fulfilled', 'cancelled', 'expired'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid status',
        });
        return;
      }

      const result = await pool.query(
        `UPDATE blood_requests 
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND requester_id = $3
         RETURNING *`,
        [status, requestId, userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Request not found or unauthorized',
        });
        return;
      }

      res.status(200).json({
        status: 'success',
        message: 'Request status updated successfully',
        data: {
          request: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Update request status error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update request status',
      });
    }
  },

  // Cancel request
  cancelRequest: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { requestId } = req.params;

      const result = await pool.query(
        `UPDATE blood_requests 
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND requester_id = $2
         RETURNING *`,
        [requestId, userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Request not found or unauthorized',
        });
        return;
      }

      res.status(200).json({
        status: 'success',
        message: 'Request cancelled successfully',
      });
    } catch (error) {
      console.error('Cancel request error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to cancel request',
      });
    }
  },

  // Respond to request (donor)
  respondToRequest: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const donorId = req.user?.id;
      const { requestId } = req.params;
      const { message, availability } = req.body;

      // Check if request exists and is active
      const requestCheck = await pool.query(
        'SELECT id FROM blood_requests WHERE id = $1 AND status = $2',
        [requestId, 'active']
      );

      if (requestCheck.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Active request not found',
        });
        return;
      }

      // Check if already responded
      const existingResponse = await pool.query(
        'SELECT id FROM donor_responses WHERE request_id = $1 AND donor_id = $2',
        [requestId, donorId]
      );

      if (existingResponse.rows.length > 0) {
        res.status(400).json({
          status: 'error',
          message: 'You have already responded to this request',
        });
        return;
      }

      const result = await pool.query(
        `INSERT INTO donor_responses (request_id, donor_id, message, availability, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [requestId, donorId, message, availability]
      );

      // Emit real-time notification to requester
      // This would be handled by Socket.io

      res.status(201).json({
        status: 'success',
        message: 'Response submitted successfully',
        data: {
          response: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Respond to request error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to submit response',
      });
    }
  },

  // Get request responses
  getRequestResponses: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { requestId } = req.params;

      // Verify request ownership
      const requestCheck = await pool.query(
        'SELECT id FROM blood_requests WHERE id = $1 AND requester_id = $2',
        [requestId, userId]
      );

      if (requestCheck.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Request not found or unauthorized',
        });
        return;
      }

      const result = await pool.query(
        `SELECT 
          dr.*,
          u.name as donor_name,
          u.blood_type,
          u.phone,
          u.is_verified,
          ST_X(u.location::geometry) as donor_longitude, 
          ST_Y(u.location::geometry) as donor_latitude
         FROM donor_responses dr
         JOIN users u ON dr.donor_id = u.id
         WHERE dr.request_id = $1
         ORDER BY dr.created_at DESC`,
        [requestId]
      );

      res.status(200).json({
        status: 'success',
        data: {
          responses: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get request responses error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch request responses',
      });
    }
  },

  // Select donor for request
  selectDonor: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { requestId } = req.params;
      const { donorId } = req.body;
  
      if (!userId || !donorId) {
        res.status(400).json({
          status: 'error',
          message: 'User ID and donor ID are required',
        });
        return;
      }
  
      // Verify request ownership and that it's active
      const requestCheck = await pool.query(
        'SELECT id, status FROM blood_requests WHERE id = $1 AND requester_id = $2',
        [requestId, userId]
      );
  
      if (requestCheck.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'Request not found or unauthorized',
        });
        return;
      }
  
      if (requestCheck.rows[0].status !== 'active') {
        res.status(400).json({
          status: 'error',
          message: 'Cannot select donor for a completed or cancelled request',
        });
        return;
      }
  
      // Verify donor exists and has responded to this request
      const donorResponseCheck = await pool.query(
        `SELECT dr.id 
         FROM donor_responses dr 
         JOIN users u ON dr.donor_id = u.id 
         WHERE dr.request_id = $1 AND dr.donor_id = $2 AND dr.status = 'pending'
         AND u.user_type IN ('donor', 'both')`,
        [requestId, donorId]
      );
  
      if (donorResponseCheck.rows.length === 0) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid donor or donor has not responded to this request',
        });
        return;
      }
  
      // Start transaction for multiple operations
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
  
        // Update donor response status
        await client.query(
          'UPDATE donor_responses SET status = $1 WHERE request_id = $2 AND donor_id = $3',
          ['accepted', requestId, donorId]
        );
  
        // Reject other responses
        await client.query(
          'UPDATE donor_responses SET status = $1 WHERE request_id = $2 AND donor_id != $3 AND status = $4',
          ['rejected', requestId, donorId, 'pending']
        );
  
        // Update request status
        await client.query(
          'UPDATE blood_requests SET status = $1, updated_at = NOW() WHERE id = $2',
          ['fulfilled', requestId]
        );
  
        // Create donation record
        await client.query(
          'INSERT INTO donations (request_id, donor_id, status) VALUES ($1, $2, $3)',
          [requestId, donorId, 'scheduled']
        );
  
        await client.query('COMMIT');
  
        res.status(200).json({
          status: 'success',
          message: 'Donor selected successfully',
        });
  
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
  
    } catch (error) {
      console.error('Select donor error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to select donor',
      });
    }
  },

  // Get user request history
  getUserRequestHistory: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { limit = 20, offset = 0 } = req.query;

      const result = await pool.query(
        `SELECT 
          br.*,
          COUNT(dr.id) as response_count
         FROM blood_requests br
         LEFT JOIN donor_responses dr ON br.id = dr.request_id
         WHERE br.requester_id = $1
         GROUP BY br.id
         ORDER BY br.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      res.status(200).json({
        status: 'success',
        data: {
          requests: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get user request history error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch request history',
      });
    }
  },

  // Get user donation history
  getUserDonationHistory: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { limit = 20, offset = 0 } = req.query;

      const result = await pool.query(
        `SELECT 
          d.*,
          br.patient_name,
          br.blood_type,
          br.hospital,
          u.name as requester_name
         FROM donations d
         JOIN blood_requests br ON d.request_id = br.id
         JOIN users u ON br.requester_id = u.id
         WHERE d.donor_id = $1
         ORDER BY d.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      res.status(200).json({
        status: 'success',
        data: {
          donations: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get user donation history error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch donation history',
      });
    }
  },

  // Create emergency request
  createEmergencyRequest: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const requestData = { ...req.body, urgency: 'critical' };

      // Use the same logic as createRequest but with critical urgency
      const result = await pool.query(
        `INSERT INTO blood_requests 
         (requester_id, patient_name, blood_type, units_needed, hospital, urgency, location, additional_notes, status, is_emergency)
         VALUES ($1, $2, $3, $4, $5, 'critical', ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, 'active', true)
         RETURNING *`,
        [
          userId, requestData.patientName, requestData.bloodType, 
          requestData.unitsNeeded, requestData.hospital,
          requestData.location.longitude, requestData.location.latitude, 
          requestData.additionalNotes
        ]
      );

      // Emergency requests would trigger immediate notifications to all nearby donors

      res.status(201).json({
        status: 'success',
        message: 'Emergency blood request created successfully',
        data: {
          request: result.rows[0],
        },
      });
    } catch (error) {
      console.error('Create emergency request error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to create emergency request',
      });
    }
  },

  // Get active emergencies
  getActiveEmergencies: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { latitude, longitude, radius = 50 } = req.query;

      let query = `
        SELECT 
          br.*,
          u.name as requester_name,
          ST_X(br.location::geometry) as longitude, 
          ST_Y(br.location::geometry) as latitude
        FROM blood_requests br
        JOIN users u ON br.requester_id = u.id
        WHERE br.status = 'active' AND br.urgency = 'critical'
      `;

      const params: any[] = [];

      if (latitude && longitude) {
        query += ` AND ST_DWithin(br.location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)`;
        params.push(longitude, latitude, radius);
      }

      query += ' ORDER BY br.created_at DESC LIMIT 20';

      const result = await pool.query(query, params);

      res.status(200).json({
        status: 'success',
        data: {
          emergencies: result.rows,
          count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Get active emergencies error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch active emergencies',
      });
    }
  },
};