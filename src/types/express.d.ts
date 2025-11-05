import { Request } from 'express';
import { JwtPayload } from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    userType: string;
  };
}

export interface JwtUserPayload extends JwtPayload {
  id: string;
  email: string;
  userType: string;
}