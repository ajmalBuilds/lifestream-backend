import { Request } from 'express';

export interface AuthToken {
  id: string;
  email: string;
  userType: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthToken;
}

// Extend the Express Request interface globally
declare global {
  namespace Express {
    interface Request {
      user?: AuthToken;
    }
  }
}