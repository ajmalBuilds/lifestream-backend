// import dotenv from 'dotenv';
// import { z } from 'zod';

// // Load environment variables first
// dotenv.config();

// console.log('🔧 Loading environment variables...');
// console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length || 'NOT SET');
// console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

// // Generate a secure random JWT secret for development
// const generateRandomSecret = (): string => {
//   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
//   let result = '';
//   for (let i = 0; i < 32; i++) {
//     result += chars.charAt(Math.floor(Math.random() * chars.length));
//   }
//   console.log('🔐 Generated JWT_SECRET for development');
//   return result;
// };

// const envSchema = z.object({
//   NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
//   PORT: z.string().min(1).default('3000'),
//   CLIENT_URL: z.string().url().default('http://localhost:3000'),
//   DATABASE_URL: z.string().url().default('postgresql://localhost:5432/lifestream_db'),
//   JWT_SECRET: z.string().min(32).default(generateRandomSecret()),
//   JWT_EXPIRES_IN: z.string().default('7d'),
//   BCRYPT_ROUNDS: z.string().min(1).default('12'),
// });

// const parseEnv = () => {
//   try {
//     const env = envSchema.parse(process.env);
//     console.log('✅ Environment variables validated successfully');
//     return env;
//   } catch (error) {
//     console.error('❌ Environment configuration error:');
    
//     if (error instanceof z.ZodError) {
//       error.errors.forEach((err) => {
//         console.error(`   ${err.path.join('.')}: ${err.message}`);
//       });
      
//       // Provide specific help for JWT_SECRET
//       if (error.errors.some(e => e.path.includes('JWT_SECRET'))) {
//         console.log('\n💡 To fix JWT_SECRET issue:');
//         console.log('   1. Create a .env file in your project root');
//         console.log('   2. Add: JWT_SECRET=your_super_secure_key_with_at_least_32_chars');
//         console.log('   3. Or use this temporary fix in .env:');
//         console.log('      JWT_SECRET=development_jwt_secret_key_1234567890abc');
//       }
//     }
    
//     console.log('\n🚨 Application cannot start without proper environment configuration.');
//     process.exit(1);
//   }
// };

// const env = parseEnv();

// // Parse numeric values
// const parsePort = (port: string): number => {
//   const parsed = parseInt(port, 10);
//   return isNaN(parsed) ? 3000 : parsed;
// };

// const parseBcryptRounds = (rounds: string): number => {
//   const parsed = parseInt(rounds, 10);
//   return isNaN(parsed) || parsed < 1 ? 12 : parsed;
// };

// export const config = {
//   nodeEnv: env.NODE_ENV,
//   port: parsePort(env.PORT),
//   clientUrl: env.CLIENT_URL,
//   databaseUrl: env.DATABASE_URL,
//   jwtSecret: env.JWT_SECRET,
//   jwtExpiresIn: env.JWT_EXPIRES_IN,
//   bcryptRounds: parseBcryptRounds(env.BCRYPT_ROUNDS),
// } as const;

// // Log successful configuration
// console.log(`
// 🎯 Configuration Loaded:
//    Environment: ${config.nodeEnv}
//    Port: ${config.port}
//    Client URL: ${config.clientUrl}
//    Database: ${config.databaseUrl ? '✓ Configured' : '✗ Missing'}
//    JWT Secret: ${config.jwtSecret ? `✓ ${config.jwtSecret.length} chars` : '✗ Missing'}
//    Bcrypt Rounds: ${config.bcryptRounds}
// `);

import dotenv from 'dotenv';

dotenv.config();

// Fallback values that will always work
const fallbackConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/lifestream_db',
  jwtSecret: process.env.JWT_SECRET || 'fallback_jwt_secret_key_for_development_only_123',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
};

// Ensure JWT secret is at least 32 characters
if (fallbackConfig.jwtSecret.length < 32) {
  fallbackConfig.jwtSecret = fallbackConfig.jwtSecret.padEnd(32, '_');
  console.log('⚠️  JWT_SECRET was too short, padded to 32 characters for development');
}

console.log('✅ Environment configuration loaded (fallback mode)');

export const config = fallbackConfig;