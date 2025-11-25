// clearUsers.ts
import { pool } from './database';

export async function clearAllUsers(): Promise<number> {
  const client = await pool.connect();
  
  try {
    const result = await client.query('DELETE FROM users');
    console.log(`✅ Cleared ${result.rowCount} users`);
    return result.rowCount || 0;
  } catch (error) {
    console.error('❌ Failed to clear users:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  clearAllUsers()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}