import { Pool } from 'pg';
import { config } from './env';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const testConnection = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    
    // Test the connection with a simple query
    await client.query('SELECT NOW()');
    client.release();
    
    console.log('✅ Database query test successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
};