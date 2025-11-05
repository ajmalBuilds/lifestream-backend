import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { config } from '../config/env';
import { AuthenticatedRequest } from '../types/express';

// Types
interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  bloodType: string;
  userType: 'donor' | 'recipient' | 'both';
  phone: string;
  dateOfBirth?: string;
  gender?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

interface LoginRequest {
  email: string;
  password: string;
}

interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  bloodType?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export const authController = {
  // User registration
  register: async (req: Request<{}, {}, RegisterRequest>, res: Response): Promise<void> => {
    try {
      const {
        name,
        email,
        password,
        bloodType,
        userType,
        phone,
        dateOfBirth,
        gender,
        location
      } = req.body;

      // Validation
      if (!name || !email || !password || !bloodType || !userType || !phone) {
        res.status(400).json({
          status: 'error',
          message: 'All fields are required: name, email, password, bloodType, userType, phone',
        });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({
          status: 'error',
          message: 'Password must be at least 6 characters long',
        });
        return;
      }

      if (!['donor', 'recipient', 'both'].includes(userType)) {
        res.status(400).json({
          status: 'error',
          message: 'User type must be donor, recipient, or both',
        });
        return;
      }

      // Check if user already exists
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        res.status(409).json({
          status: 'error',
          message: 'User with this email already exists',
        });
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, config.bcryptRounds);
      const userId = uuidv4();
      console.log("UserId: ",userId);

      console.log('Creating user with ID:', userId);

      // Prepare location if provided
      let locationQuery = '';
      let locationParams: any[] = [];
      
      if (location && location.latitude && location.longitude) {
        locationQuery = ', location = ST_SetSRID(ST_MakePoint($11, $12), 4326)';
        locationParams = [location.longitude, location.latitude];
      }

      // Create user
      const query = `
        INSERT INTO users 
        (id, name, email, password, blood_type, user_type, phone, date_of_birth, gender, is_verified${locationQuery})
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${locationQuery ? ', $11, $12' : ''})
        RETURNING 
          id, name, email, blood_type, user_type, phone, 
          date_of_birth, gender, is_verified, created_at,
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude
      `;

      const params = [
        userId,
        name.trim(),
        email.toLowerCase().trim(),
        hashedPassword,
        bloodType,
        userType,
        phone.trim(),
        dateOfBirth || null,
        gender || null,
        false,
        ...locationParams
      ];

      const result = await pool.query(query, params);
      const user = result.rows[0];

      // Generate JWT token
      const tokenPayload = {
        id: user.id,
        email: user.email,
        userType: user.user_type
      };

      const token = jwt.sign(
        tokenPayload,
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
      );

      res.status(201).json({
        status: 'success',
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            bloodType: user.blood_type,
            userType: user.user_type,
            phone: user.phone,
            dateOfBirth: user.date_of_birth,
            gender: user.gender,
            isVerified: user.is_verified,
            location: user.longitude && user.latitude ? {
              longitude: user.longitude,
              latitude: user.latitude
            } : undefined,
            createdAt: user.created_at
          },
          token
        },
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      
      // Handle specific database errors
      if (error.code === '22P02') {
        res.status(500).json({
          status: 'error',
          message: 'Database schema mismatch. Please check if UUID extension is enabled.',
        });
        return;
      }

      res.status(500).json({
        status: 'error',
        message: 'Registration failed. Please try again.',
        ...(config.nodeEnv === 'development' && { details: error.message })
      });
    }
  },

  // User login
  login: async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({
          status: 'error',
          message: 'Email and password are required',
        });
        return;
      }

      // Find user with location
      const result = await pool.query(
        `SELECT 
          id, name, email, password, blood_type, user_type, 
          phone, date_of_birth, gender, is_verified, created_at,
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude
         FROM users 
         WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        res.status(401).json({
          status: 'error',
          message: 'Invalid email or password',
        });
        return;
      }

      const user = result.rows[0];

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        res.status(401).json({
          status: 'error',
          message: 'Invalid email or password',
        });
        return;
      }

      // Generate JWT token
      const tokenPayload = {
        id: user.id,
        email: user.email,
        userType: user.user_type
      };

      const token = jwt.sign(
        tokenPayload,
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
      );

      res.status(200).json({
        status: 'success',
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            bloodType: user.blood_type,
            userType: user.user_type,
            phone: user.phone,
            dateOfBirth: user.date_of_birth,
            gender: user.gender,
            isVerified: user.is_verified,
            location: user.longitude && user.latitude ? {
              longitude: user.longitude,
              latitude: user.latitude
            } : undefined,
            createdAt: user.created_at
          },
          token
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Login failed. Please try again.',
      });
    }
  },

  // Email verification
  verifyEmail: async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.body;

      if (!token) {
        res.status(400).json({
          status: 'error',
          message: 'Verification token is required',
        });
        return;
      }

      // Verify the token
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      
      const result = await pool.query(
        'UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1 RETURNING id, email',
        [decoded.userId]
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
        message: 'Email verified successfully',
        data: {
          user: {
            id: result.rows[0].id,
            email: result.rows[0].email,
            isVerified: true
          }
        }
      });
    } catch (error) {
      console.error('Email verification error:', error);
      
      if (error instanceof jwt.JsonWebTokenError) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid verification token',
        });
      } else if (error instanceof jwt.TokenExpiredError) {
        res.status(400).json({
          status: 'error',
          message: 'Verification token expired',
        });
      } else {
        res.status(400).json({
          status: 'error',
          message: 'Invalid or expired verification token',
        });
      }
    }
  },

  // Forgot password
  forgotPassword: async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          status: 'error',
          message: 'Email is required',
        });
        return;
      }

      // Check if user exists
      const result = await pool.query(
        'SELECT id, name FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      // Always return success to prevent email enumeration
      const response: any = {
        status: 'success',
        message: 'If an account with that email exists, a password reset link has been sent.',
      };

      if (result.rows.length > 0) {
        const userId = result.rows[0].id;
        const userName = result.rows[0].name;

        // Generate reset token (valid for 1 hour)
        const resetTokenPayload = { 
          userId, 
          type: 'password_reset',
          email: email.toLowerCase()
        };

        const resetToken = jwt.sign(
          resetTokenPayload,
          config.jwtSecret,
          { expiresIn: '1h' }
        );

        // In a real implementation, you'd send an email with the reset token
        console.log(`Password reset token for ${email}: ${resetToken}`);
        console.log(`Reset link: ${config.clientUrl}/reset-password?token=${resetToken}`);

        // Include token in development for testing
        if (config.nodeEnv === 'development') {
          response.resetToken = resetToken;
          response.resetLink = `${config.clientUrl}/reset-password?token=${resetToken}`;
        }
      }

      res.status(200).json(response);
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to process password reset request',
      });
    }
  },

  // Reset password
  resetPassword: async (req: Request, res: Response): Promise<void> => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        res.status(400).json({
          status: 'error',
          message: 'Token and new password are required',
        });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({
          status: 'error',
          message: 'Password must be at least 6 characters long',
        });
        return;
      }

      // Verify reset token
      const decoded = jwt.verify(token, config.jwtSecret) as { 
        userId: string; 
        type: string;
        email: string;
      };

      if (decoded.type !== 'password_reset') {
        res.status(400).json({
          status: 'error',
          message: 'Invalid reset token',
        });
        return;
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, config.bcryptRounds);

      // Update password
      const result = await pool.query(
        'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email',
        [hashedPassword, decoded.userId]
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
        message: 'Password reset successfully',
      });
    } catch (error) {
      console.error('Reset password error:', error);
      
      if (error instanceof jwt.JsonWebTokenError) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid reset token',
        });
      } else if (error instanceof jwt.TokenExpiredError) {
        res.status(400).json({
          status: 'error',
          message: 'Reset token has expired',
        });
      } else {
        res.status(500).json({
          status: 'error',
          message: 'Failed to reset password',
        });
      }
    }
  },

  // Get current user
  getMe: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated',
        });
        return;
      }

      const result = await pool.query(
        `SELECT 
          id, name, email, blood_type, user_type, phone, 
          date_of_birth, gender, is_verified, created_at, updated_at,
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude
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

      const user = result.rows[0];

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            bloodType: user.blood_type,
            userType: user.user_type,
            phone: user.phone,
            dateOfBirth: user.date_of_birth,
            gender: user.gender,
            isVerified: user.is_verified,
            location: user.longitude && user.latitude ? {
              longitude: user.longitude,
              latitude: user.latitude
            } : undefined,
            createdAt: user.created_at,
            updatedAt: user.updated_at
          }
        },
      });
    } catch (error) {
      console.error('Get me error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch user data',
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

      // Build dynamic update query
      const updates: string[] = [];
      const params: any[] = [];
      let paramCount = 0;

      if (name !== undefined) {
        paramCount++;
        updates.push(`name = $${paramCount}`);
        params.push(name.trim());
      }

      if (phone !== undefined) {
        paramCount++;
        updates.push(`phone = $${paramCount}`);
        params.push(phone.trim());
      }

      if (dateOfBirth !== undefined) {
        paramCount++;
        updates.push(`date_of_birth = $${paramCount}`);
        params.push(dateOfBirth);
      }

      if (gender !== undefined) {
        paramCount++;
        updates.push(`gender = $${paramCount}`);
        params.push(gender);
      }

      if (bloodType !== undefined) {
        paramCount++;
        updates.push(`blood_type = $${paramCount}`);
        params.push(bloodType);
      }

      if (location && location.latitude && location.longitude) {
        paramCount++;
        updates.push(`location = ST_SetSRID(ST_MakePoint($${paramCount}, $${paramCount + 1}), 4326)`);
        params.push(location.longitude, location.latitude);
        paramCount++;
      }

      if (updates.length === 0) {
        res.status(400).json({
          status: 'error',
          message: 'No fields to update',
        });
        return;
      }

      updates.push('updated_at = NOW()');
      
      paramCount++;
      params.push(userId);

      const query = `
        UPDATE users 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING 
          id, name, email, blood_type, user_type, phone, 
          date_of_birth, gender, is_verified, created_at, updated_at,
          ST_X(location::geometry) as longitude, 
          ST_Y(location::geometry) as latitude
      `;

      const result = await pool.query(query, params);

      if (result.rows.length === 0) {
        res.status(404).json({
          status: 'error',
          message: 'User not found',
        });
        return;
      }

      const user = result.rows[0];

      res.status(200).json({
        status: 'success',
        message: 'Profile updated successfully',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            bloodType: user.blood_type,
            userType: user.user_type,
            phone: user.phone,
            dateOfBirth: user.date_of_birth,
            gender: user.gender,
            isVerified: user.is_verified,
            location: user.longitude && user.latitude ? {
              longitude: user.longitude,
              latitude: user.latitude
            } : undefined,
            createdAt: user.created_at,
            updatedAt: user.updated_at
          }
        },
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update profile',
      });
    }
  }
};