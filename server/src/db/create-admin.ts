import { pool } from './pool.js';
import { hashPassword } from '../modules/auth/password.js';

async function main() {
  const email = 'admin@tixhub.fit';
  const rawPassword = 'Admin@123456';
  const nickname = 'System Admin';

  const existing = await pool.query(`SELECT id, is_admin FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    if (!user.is_admin) {
      await pool.query(`UPDATE users SET is_admin = true WHERE id = $1`, [user.id]);
      console.log(`Updated user ${email} (ID: ${user.id}) to is_admin = true`);
    } else {
      console.log(`User ${email} (ID: ${user.id}) is already admin.`);
    }
  } else {
    const passwordHash = await hashPassword(rawPassword);
    const result = await pool.query(
      `INSERT INTO users (email, nickname, password_hash, provider, is_admin)
       VALUES ($1, $2, $3, 'email', true)
       RETURNING id`,
      [email, nickname, passwordHash]
    );
    const userId = result.rows[0].id;
    await pool.query(`INSERT INTO wallets (user_id, balance_amount) VALUES ($1, 0)`, [userId]);
    console.log(`Created admin user ${email} with ID ${userId}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
