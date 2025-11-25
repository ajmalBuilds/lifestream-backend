import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { config } from '../config/env';
import { JwtUserPayload } from '../types/express';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    email: string;
    userType: string;
  };
}

interface CreateRequestData {
  patientName: string;
  bloodType: string;
  unitsNeeded: number;
  hospital: string;
  urgency: string;
  location: {
    latitude: number;
    longitude: number;
  };
  additionalNotes?: string;
}

interface DonorResponseData {
  requestId: string;
  message: string;
  availability: string;
}

interface LocationUpdateData {
  latitude: number;
  longitude: number;
}

interface StatusUpdateData {
  requestId: string;
  status: string;
}

interface EmergencyAlertData {
  requestId: string;
  message: string;
}

export const setupSocketHandlers = (io: SocketIOServer): void => {
  // Authentication middleware for sockets
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        console.error('No token provided for socket connection');
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as JwtUserPayload;
      
      // Verify user exists in database
      const userResult = await pool.query(
        'SELECT id, email, user_type, name FROM users WHERE id = $1',
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        console.error('User not found for socket connection:', decoded.id);
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = {
        id: userResult.rows[0].id,
        email: userResult.rows[0].email,
        userType: userResult.rows[0].user_type
      };
      
      console.log('Socket authenticated:', socket.user.email);
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('New client connected:', socket.id, 'User:', socket.user?.email);
    console.log('Total connected clients:', io.engine.clientsCount);

    // Send welcome message
    socket.emit('welcome', { 
      message: 'Welcome to LifeStream Real-Time Service!', 
      socketId: socket.id,
      userId: socket.user?.id,
      timestamp: new Date().toISOString()
    });

    // Join user to their personal room
    socket.on('join-user', (userId: string) => {
      console.log('Join user room request:', userId);
      
      if (socket.user?.id !== userId) {
        console.error('Unauthorized user join attempt:', { socketUser: socket.user?.id, requestUser: userId });
        socket.emit('error', { message: 'Unauthorized user join attempt' });
        return;
      }
      
      socket.join(`user:${userId}`);
      console.log(`User ${userId} joined their room`);
      socket.emit('joined-room', { 
        room: `user:${userId}`,
        userId: userId,
        timestamp: new Date().toISOString()
      });
    });

    // Handle real-time blood request
    socket.on('create-request', async (requestData: CreateRequestData) => {
      console.log('New blood request received from:', socket.user?.email);
      
      try {
        if (!socket.user?.id) {
          throw new Error('User not authenticated');
        }

        // Validate required fields
        if (!requestData.patientName || !requestData.bloodType || !requestData.unitsNeeded) {
          throw new Error('Missing required fields: patientName, bloodType, unitsNeeded');
        }

        // Save to database
        const requestId = uuidv4();
        const result = await pool.query(
          `INSERT INTO blood_requests 
           (id, requester_id, patient_name, blood_type, units_needed, hospital, urgency, location, additional_notes, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, 'active')
           RETURNING *`,
          [
            requestId, 
            socket.user.id, 
            requestData.patientName, 
            requestData.bloodType, 
            requestData.unitsNeeded, 
            requestData.hospital, 
            requestData.urgency,
            requestData.location.longitude, 
            requestData.location.latitude, 
            requestData.additionalNotes || ''
          ]
        );

        const savedRequest = result.rows[0];
        
        // Get requester name for broadcast
        const userResult = await pool.query(
          'SELECT name FROM users WHERE id = $1',
          [socket.user.id]
        );
        const requesterName = userResult.rows[0]?.name || socket.user.email.split('@')[0];
        
        // Broadcast to all connected clients except sender
        socket.broadcast.emit('new-blood-request', {
          ...savedRequest,
          requester_name: requesterName,
          broadcastTime: new Date().toISOString()
        });
        
        // Confirm to sender
        socket.emit('request-created', { 
          status: 'success', 
          requestId: savedRequest.id,
          message: 'Blood request created and broadcasted to nearby donors',
          timestamp: new Date().toISOString()
        });

        console.log(`Blood request created: ${savedRequest.id}`);

      } catch (error) {
        console.error('Error creating request:', error);
        socket.emit('request-error', { 
          message: error instanceof Error ? error.message : 'Failed to create blood request',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle donor response to request
    socket.on('donor-response', async (responseData: DonorResponseData) => {
      const { requestId, message, availability } = responseData;
      const donorId = socket.user?.id;
      
      console.log(`Donor response from ${donorId} for request ${requestId}`);
      
      if (!donorId) {
        socket.emit('response-error', { message: 'User not authenticated' });
        return;
      }

      try {
        // Check if request exists and is active
        const requestCheck = await pool.query(
          'SELECT requester_id, patient_name FROM blood_requests WHERE id = $1 AND status = $2',
          [requestId, 'active']
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('response-error', { message: 'Active request not found' });
          return;
        }

        const requesterId = requestCheck.rows[0].requester_id;
        const patientName = requestCheck.rows[0].patient_name;
        const responseId = uuidv4();

        // Save response to database
        const result = await pool.query(
          `INSERT INTO donor_responses (id, request_id, donor_id, message, availability, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           RETURNING *`,
          [responseId, requestId, donorId, message, availability]
        );

        // Get donor info for notification
        const donorResult = await pool.query(
          'SELECT name, blood_type FROM users WHERE id = $1',
          [donorId]
        );
        const donorName = donorResult.rows[0]?.name || socket.user?.email.split('@')[0];
        const donorBloodType = donorResult.rows[0]?.blood_type;

        // Notify the requester
        io.to(`user:${requesterId}`).emit('donor-available', {
          requestId,
          patientName,
          donorId,
          donorName,
          donorBloodType,
          message,
          availability,
          responseTime: new Date().toISOString(),
          responseId: result.rows[0].id
        });

        socket.emit('response-sent', {
          status: 'success',
          message: 'Response sent successfully',
          responseId: result.rows[0].id,
          timestamp: new Date().toISOString()
        });

        console.log(`Donor response sent: ${responseId}`);

      } catch (error) {
        console.error('Error handling donor response:', error);
        socket.emit('response-error', { 
          message: error instanceof Error ? error.message : 'Failed to send response',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle location updates
    socket.on('update-location', async (locationData: LocationUpdateData) => {
      const { latitude, longitude } = locationData;
      const userId = socket.user?.id;
      
      console.log(`Location update from user ${userId}`);
      
      if (!userId) {
        return;
      }

      try {
        await pool.query(
          `UPDATE users 
           SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326), updated_at = NOW()
           WHERE id = $3`,
          [longitude, latitude, userId]
        );
        
        // Broadcast to relevant users (you might want to filter this)
        socket.broadcast.emit('location-updated', {
          userId,
          userEmail: socket.user?.email,
          location: { latitude, longitude },
          timestamp: new Date().toISOString()
        });

        console.log(`Location updated for user ${userId}`);

      } catch (error) {
        console.error('Error updating location:', error);
      }
    });

    // Handle request status updates
    socket.on('update-request-status', async (data: StatusUpdateData) => {
      const { requestId, status } = data;
      const userId = socket.user?.id;

      console.log(`Status update request: ${requestId} -> ${status} by ${userId}`);

      if (!userId) {
        socket.emit('status-update-error', { message: 'User not authenticated' });
        return;
      }

      try {
        // Verify user owns the request or is admin
        const requestCheck = await pool.query(
          'SELECT id, requester_id, patient_name FROM blood_requests WHERE id = $1',
          [requestId]
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('status-update-error', { message: 'Request not found' });
          return;
        }

        const request = requestCheck.rows[0];
        
        // Check if user is requester or admin
        if (request.requester_id !== userId && socket.user?.userType !== 'admin') {
          socket.emit('status-update-error', { message: 'Unauthorized to update this request' });
          return;
        }

        // Update request status
        await pool.query(
          'UPDATE blood_requests SET status = $1, updated_at = NOW() WHERE id = $2',
          [status, requestId]
        );

        // Notify all interested parties
        io.emit('request-status-updated', {
          requestId,
          patientName: request.patient_name,
          status,
          updatedBy: userId,
          updatedByEmail: socket.user?.email,
          timestamp: new Date().toISOString()
        });

        socket.emit('status-update-success', {
          message: 'Request status updated successfully',
          requestId,
          status,
          timestamp: new Date().toISOString()
        });

        console.log(`Request status updated: ${requestId} -> ${status}`);

      } catch (error) {
        console.error('Error updating request status:', error);
        socket.emit('status-update-error', { 
          message: error instanceof Error ? error.message : 'Failed to update request status',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle emergency alerts
    socket.on('emergency-alert', async (emergencyData: EmergencyAlertData) => {
      const { requestId, message } = emergencyData;
      const userId = socket.user?.id;

      console.log(`Emergency alert from ${userId} for request ${requestId}`);

      if (!userId) {
        socket.emit('emergency-error', { message: 'User not authenticated' });
        return;
      }

      try {
        // Verify user has access to the request
        const requestCheck = await pool.query(
          `SELECT id, patient_name, requester_id FROM blood_requests 
           WHERE id = $1 AND (requester_id = $2 OR id IN (
             SELECT request_id FROM donor_responses WHERE donor_id = $2
           ))`,
          [requestId, userId]
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('emergency-error', { message: 'Access denied to this request' });
          return;
        }

        const request = requestCheck.rows[0];
        const userName = socket.user?.email.split('@')[0];

        // Broadcast emergency alert to all connected users
        io.emit('emergency-alert-received', {
          requestId,
          patientName: request.patient_name,
          message,
          alertBy: userId,
          alertByName: userName,
          timestamp: new Date().toISOString(),
          urgent: true
        });

        socket.emit('emergency-sent', {
          message: 'Emergency alert sent successfully',
          timestamp: new Date().toISOString()
        });

        console.log(`Emergency alert sent for request ${requestId}`);

      } catch (error) {
        console.error('Error sending emergency alert:', error);
        socket.emit('emergency-error', { 
          message: error instanceof Error ? error.message : 'Failed to send emergency alert',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log('Client disconnected:', socket.id, 'User:', socket.user?.email, 'Reason:', reason);
      console.log('Remaining connected clients:', io.engine.clientsCount);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error for user', socket.user?.email, ':', error);
    });
  });

  console.log('Main socket handlers setup complete');
};