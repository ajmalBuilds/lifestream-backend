import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { config } from '../config/env';

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
}

interface LoginRequest {
  email: string;
  password: string;
}

interface AuthToken {
  id: string;
  email: string;
  userType: string;
}

// JWT Sign Options interface
interface JWTSignOptions {
  expiresIn: string | number;
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
        gender
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

      // Check if user already exists
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );

      if (existingUser.rows.length > 0) {
        res.status(409).json({
          status: 'error',
          message: 'User with this email already exists',
        });
        return;
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const result = await pool.query(
        `INSERT INTO users 
         (name, email, password, blood_type, user_type, phone, date_of_birth, gender, is_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, email, blood_type, user_type, phone, is_verified, created_at`,
        [
          name,
          email,
          hashedPassword,
          bloodType,
          userType,
          phone,
          dateOfBirth || null,
          gender || null,
          false // Start as unverified
        ]
      );

      const user = result.rows[0];

      // Generate JWT token with proper typing
      const tokenPayload = {
        id: user.id,
        email: user.email,
        userType: user.user_type
      };

      const signOptions: jwt.SignOptions = {
        expiresIn: config.jwtExpiresIn
      };

      const token = jwt.sign(
        tokenPayload,
        config.jwtSecret,
        signOptions
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
            isVerified: user.is_verified
          },
          token
        },
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Registration failed. Please try again.',
      });
    }
  },

  // User login
  login: async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        res.status(400).json({
          status: 'error',
          message: 'Email and password are required',
        });
        return;
      }

      // Find user
      const result = await pool.query(
        `SELECT 
          id, name, email, password, blood_type, user_type, 
          phone, is_verified, created_at
         FROM users 
         WHERE email = $1`,
        [email]
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

      // Generate JWT token with proper typing
      const tokenPayload = {
        id: user.id,
        email: user.email,
        userType: user.user_type
      };

      const signOptions: jwt.SignOptions = {
        expiresIn: config.jwtExpiresIn
      };

      const token = jwt.sign(
        tokenPayload,
        config.jwtSecret,
        signOptions
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
            isVerified: user.is_verified,
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
      
      await pool.query(
        'UPDATE users SET is_verified = true WHERE id = $1',
        [decoded.userId]
      );

      res.status(200).json({
        status: 'success',
        message: 'Email verified successfully',
      });
    } catch (error) {
      console.error('Email verification error:', error);
      res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification token',
      });
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
        'SELECT id FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        // Don't reveal whether email exists or not
        res.status(200).json({
          status: 'success',
          message: 'If the email exists, a password reset link has been sent',
        });
        return;
      }

      const userId = result.rows[0].id;

      // Generate reset token (valid for 1 hour)
      const resetTokenPayload = { 
        userId, 
        type: 'password_reset' 
      };

      const resetToken = jwt.sign(
        resetTokenPayload,
        config.jwtSecret,
        { expiresIn: '1h' } as jwt.SignOptions
      );

      // In a real implementation, you'd send an email with the reset token
      console.log(`Password reset token for ${email}: ${resetToken}`);

      res.status(200).json({
        status: 'success',
        message: 'If the email exists, a password reset link has been sent',
        // In development, return the token for testing
        ...(config.nodeEnv === 'development' && { resetToken })
      });
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
      };

      if (decoded.type !== 'password_reset') {
        res.status(400).json({
          status: 'error',
          message: 'Invalid reset token',
        });
        return;
      }

      // Hash new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2',
        [hashedPassword, decoded.userId]
      );

      res.status(200).json({
        status: 'success',
        message: 'Password reset successfully',
      });
    } catch (error) {
      console.error('Reset password error:', error);
      if (error instanceof jwt.JsonWebTokenError) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid or expired reset token',
        });
      } else {
        res.status(500).json({
          status: 'error',
          message: 'Failed to reset password',
        });
      }
    }
  },

  // Get current user (for token verification)
  getMe: async (req: Request, res: Response): Promise<void> => {
    try {
      // This requires auth middleware to be applied first
      const userId = (req as any).user?.id;

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
          date_of_birth, gender, is_verified, created_at
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
            createdAt: user.created_at
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

  // Update user profile (alternative to userController for basic updates)
  updateProfile: async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      const { name, phone, dateOfBirth, gender } = req.body;

      if (!userId) {
        res.status(401).json({
          status: 'error',
          message: 'Not authenticated',
        });
        return;
      }

      const result = await pool.query(
        `UPDATE users 
         SET name = $1, phone = $2, date_of_birth = $3, gender = $4, updated_at = NOW()
         WHERE id = $5
         RETURNING id, name, email, phone, date_of_birth, gender, is_verified`,
        [name, phone, dateOfBirth, gender, userId]
      );

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
  }
};