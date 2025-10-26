"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
var dotenv_1 = require("dotenv");
dotenv_1.default.config();
exports.config = {
    port: process.env.PORT || 5000,
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/lifestream',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
    jwtExpiresIn: '7d',
    clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV || 'development',
};
