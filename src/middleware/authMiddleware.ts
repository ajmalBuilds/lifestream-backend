import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

interface AuthToken {
  id: string;
  email: string;
  userType: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthToken;
}

export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({
        status: 'error',
        message: 'Access denied. No token provided.',
      });
      return;
    }

    const decoded = jwt.verify(token, config.jwtSecret) as AuthToken;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      status: 'error',
      message: 'Invalid token.',
    });
  }
};