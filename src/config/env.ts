import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/lifestream',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'f5d3c2a1e8b7a6c9d0e4f7a2b5c8e1f3a6d9c0b4e7f2a8d5c1b9e6f3a0c7d2b5e8f1a4c9d6b7e0a3c8f5d2b9e6c1a4f7d0b3e8c5a2f9d6b1e4c7a0d3b8e5c2a9f6d1b4e7',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
} as const;