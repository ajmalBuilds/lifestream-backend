// fixNullBloodType.ts
import { pool } from './database';

async function fixNullBloodType() {
  const client = await pool.connect();
  
  try {
    const users = await client.query(
        'SELECT * from blood_requests'
    );
    console.log("Users : ", users);
    // Find users with null blood_type
    const nullUsers = await client.query(
      'SELECT id, name, email FROM users WHERE blood_type IS NULL'
    );
    
    console.log(`🔍 Found ${nullUsers.rows.length} users with null blood_type:`);
    nullUsers.rows.forEach(user => {
      console.log(`   - ${user.name} (${user.email})`);
    });

    // Fix them
    if (nullUsers.rows.length > 0) {
      const result = await client.query(
        `UPDATE users SET blood_type = 'O_positive' WHERE blood_type IS NULL`
      );
      console.log(`✅ Fixed ${result.rowCount} users with null blood_type`);
    } else {
      console.log('✅ No users with null blood_type found');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixNullBloodType();