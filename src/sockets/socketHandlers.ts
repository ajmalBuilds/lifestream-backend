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

export const setupSocketHandlers = (io: SocketIOServer): void => {
  // Authentication middleware for sockets
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as JwtUserPayload;
      
      // Verify user exists in database
      const userResult = await pool.query(
        'SELECT id, email, user_type FROM users WHERE id = $1',
        [decoded.id]
      );

      if (userResult.rows.length === 0) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = {
        id: userResult.rows[0].id,
        email: userResult.rows[0].email,
        userType: userResult.rows[0].user_type
      };
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log('🔌 New client connected:', socket.id, 'User:', socket.user?.email);
    console.log('📡 Total connected clients:', io.engine.clientsCount);

    // Send welcome message
    socket.emit('welcome', { 
      message: 'Welcome to LifeStream Real-Time Service!', 
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    // Join user to their personal room
    socket.on('join-user', (userId: string) => {
      if (socket.user?.id !== userId) {
        socket.emit('error', { message: 'Unauthorized user join attempt' });
        return;
      }
      
      socket.join(`user:${userId}`);
      console.log(`👤 User ${userId} joined their room`);
      socket.emit('joined-room', { 
        room: `user:${userId}`,
        userId: userId 
      });
    });

    // Handle real-time blood request
    socket.on('create-request', async (requestData) => {
      console.log('🆕 New blood request received:', requestData);
      
      try {
        // Save to database
        const requestId = uuidv4();
        const result = await pool.query(
          `INSERT INTO blood_requests 
           (id, requester_id, patient_name, blood_type, units_needed, hospital, urgency, location, additional_notes, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326), $10, 'active')
           RETURNING *`,
          [
            requestId, socket.user?.id, requestData.patientName, requestData.bloodType, 
            requestData.unitsNeeded, requestData.hospital, requestData.urgency,
            requestData.location.longitude, requestData.location.latitude, 
            requestData.additionalNotes
          ]
        );

        const savedRequest = result.rows[0];
        
        // Broadcast to all connected clients except sender
        socket.broadcast.emit('new-blood-request', {
          ...savedRequest,
          requester_name: socket.user?.email.split('@')[0]
        });
        
        // Confirm to sender
        socket.emit('request-created', { 
          status: 'success', 
          requestId: savedRequest.id,
          message: 'Blood request broadcasted to nearby donors'
        });

      } catch (error) {
        console.error('❌ Error creating request:', error);
        socket.emit('request-error', { 
          message: 'Failed to create blood request' 
        });
      }
    });

    // Handle donor response to request
    socket.on('donor-response', async (responseData) => {
      const { requestId, message, availability } = responseData;
      const donorId = socket.user?.id;
      const responseId = uuidv4();
      
      console.log(`🩸 Donor ${donorId} responded to request ${requestId}`);
      
      try {
        // Check if request exists and is active
        const requestCheck = await pool.query(
          'SELECT requester_id FROM blood_requests WHERE id = $1 AND status = $2',
          [requestId, 'active']
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('response-error', { message: 'Active request not found' });
          return;
        }

        const requesterId = requestCheck.rows[0].requester_id;

        // Save response to database
        const result = await pool.query(
          `INSERT INTO donor_responses (id, request_id, donor_id, message, availability, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')
           RETURNING *`,
          [responseId, requestId, donorId, message, availability]
        );

        // Notify the requester
        io.to(`user:${requesterId}`).emit('donor-available', {
          requestId,
          donorId,
          donorName: socket.user?.email.split('@')[0],
          message,
          responseTime: new Date().toISOString(),
          responseId: result.rows[0].id
        });

        socket.emit('response-sent', {
          status: 'success',
          message: 'Response sent successfully'
        });

      } catch (error) {
        console.error('❌ Error handling donor response:', error);
        socket.emit('response-error', { 
          message: 'Failed to send response' 
        });
      }
    });

    // Handle location updates
    socket.on('update-location', async (locationData) => {
      const { latitude, longitude } = locationData;
      const userId = socket.user?.id;
      
      console.log(`📍 Location update from user ${userId}`);
      
      try {
        await pool.query(
          `UPDATE users 
           SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326), updated_at = NOW()
           WHERE id = $3`,
          [longitude, latitude, userId]
        );
        
        // Broadcast to relevant users
        socket.broadcast.emit('location-updated', {
          userId,
          location: { latitude, longitude },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error updating location:', error);
      }
    });

    // Handle request status updates
    socket.on('update-request-status', async (data: { requestId: string; status: string }) => {
      const { requestId, status } = data;
      const userId = socket.user?.id;

      try {
        // Verify user owns the request
        const requestCheck = await pool.query(
          'SELECT id FROM blood_requests WHERE id = $1 AND requester_id = $2',
          [requestId, userId]
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('status-update-error', { message: 'Request not found or unauthorized' });
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
          status,
          updatedBy: userId,
          timestamp: new Date().toISOString()
        });

        socket.emit('status-update-success', {
          message: 'Request status updated successfully'
        });

      } catch (error) {
        console.error('❌ Error updating request status:', error);
        socket.emit('status-update-error', { 
          message: 'Failed to update request status' 
        });
      }
    });

    // Handle emergency alerts
    socket.on('emergency-alert', async (emergencyData) => {
      const { requestId, message } = emergencyData;
      const userId = socket.user?.id;

      try {
        // Verify user has access to the request
        const requestCheck = await pool.query(
          'SELECT id, patient_name FROM blood_requests WHERE id = $1 AND (requester_id = $2 OR id IN (SELECT request_id FROM donor_responses WHERE donor_id = $2))',
          [requestId, userId]
        );

        if (requestCheck.rows.length === 0) {
          socket.emit('emergency-error', { message: 'Access denied to this request' });
          return;
        }

        // Broadcast emergency alert to all connected users in the area
        io.emit('emergency-alert-received', {
          requestId,
          patientName: requestCheck.rows[0].patient_name,
          message,
          alertBy: userId,
          timestamp: new Date().toISOString(),
          urgent: true
        });

        socket.emit('emergency-sent', {
          message: 'Emergency alert sent successfully'
        });

      } catch (error) {
        console.error('❌ Error sending emergency alert:', error);
        socket.emit('emergency-error', { 
          message: 'Failed to send emergency alert' 
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log('🔌 Client disconnected:', socket.id, 'User:', socket.user?.email, 'Reason:', reason);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
    });
  });

  console.log('✅ Main socket handlers setup complete');
};