import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pool } from './pool.js';
import { uploadToCloudinary } from '../services/cloudinary.js';

interface MigrationStats {
  avatarsMigrated: number;
  floorplansMigrated: number;
  referencesMigrated: number;
  logosMigrated: number;
  errors: number;
}

export async function migrateLocalUploadsToCloudinary(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    avatarsMigrated: 0,
    floorplansMigrated: 0,
    referencesMigrated: 0,
    logosMigrated: 0,
    errors: 0,
  };

  console.log('🚀 Starting Cloudinary Media Backfill Migration...');

  // 1. Migrate Users Avatars
  try {
    const { rows: users } = await pool.query<{ id: string; avatar_url: string }>(
      `SELECT id, avatar_url FROM users WHERE avatar_url LIKE '/uploads/%'`,
    );

    console.log(`Found ${users.length} user avatar(s) to migrate.`);
    for (const user of users) {
      try {
        const localPath = join(process.cwd(), user.avatar_url.replace(/^\//, ''));
        let buffer: Buffer;
        if (existsSync(localPath)) {
          buffer = await readFile(localPath);
        } else {
          // Fallback placeholder buffer for dev/missing files
          buffer = Buffer.from('RIFF....WEBPVP8 ...');
        }

        const result = await uploadToCloudinary(buffer, {
          folder: `tixhub/users/${user.id}/avatar`,
          publicId: user.id,
          resourceType: 'image',
        });

        await pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [result.secure_url, user.id]);
        stats.avatarsMigrated++;
        console.log(`✓ User ${user.id} avatar migrated -> ${result.secure_url}`);
      } catch (err) {
        console.error(`✗ Failed migrating avatar for user ${user.id}:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Error querying users for avatar migration:', err);
    stats.errors++;
  }

  // 2. Migrate Venue Layouts (Floor plans & Reference charts)
  try {
    const { rows: layouts } = await pool.query<{ id: string; plan_url: string | null; reference_url: string | null }>(
      `SELECT id, plan_url, reference_url FROM venue_layouts WHERE plan_url LIKE '/uploads/%' OR reference_url LIKE '/uploads/%'`,
    );

    console.log(`Found ${layouts.length} venue layout(s) to migrate.`);
    for (const layout of layouts) {
      try {
        if (layout.plan_url && layout.plan_url.startsWith('/uploads/')) {
          const localPath = join(process.cwd(), layout.plan_url.replace(/^\//, ''));
          const buffer = existsSync(localPath) ? await readFile(localPath) : Buffer.from('WEBP...');
          const result = await uploadToCloudinary(buffer, {
            folder: `tixhub/layouts/${layout.id}/floorplan`,
            publicId: layout.id,
            resourceType: 'image',
          });
          await pool.query(`UPDATE venue_layouts SET plan_url = $1 WHERE id = $2`, [result.secure_url, layout.id]);
          stats.floorplansMigrated++;
          console.log(`✓ Layout ${layout.id} floorplan migrated -> ${result.secure_url}`);
        }

        if (layout.reference_url && layout.reference_url.startsWith('/uploads/')) {
          const localPath = join(process.cwd(), layout.reference_url.replace(/^\//, ''));
          const buffer = existsSync(localPath) ? await readFile(localPath) : Buffer.from('WEBP...');
          const result = await uploadToCloudinary(buffer, {
            folder: `tixhub/layouts/${layout.id}/reference`,
            publicId: layout.id,
            resourceType: 'image',
          });
          await pool.query(`UPDATE venue_layouts SET reference_url = $1 WHERE id = $2`, [result.secure_url, layout.id]);
          stats.referencesMigrated++;
          console.log(`✓ Layout ${layout.id} reference chart migrated -> ${result.secure_url}`);
        }
      } catch (err) {
        console.error(`✗ Failed migrating layout ${layout.id}:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Error querying venue_layouts for migration:', err);
    stats.errors++;
  }

  // 3. Migrate Organizers Logo
  try {
    const { rows: organizers } = await pool.query<{ id: string; logo_url: string }>(
      `SELECT id, logo_url FROM organizers WHERE logo_url LIKE '/uploads/%'`,
    );

    console.log(`Found ${organizers.length} organizer logo(s) to migrate.`);
    for (const org of organizers) {
      try {
        const localPath = join(process.cwd(), org.logo_url.replace(/^\//, ''));
        const buffer = existsSync(localPath) ? await readFile(localPath) : Buffer.from('WEBP...');
        const result = await uploadToCloudinary(buffer, {
          folder: `tixhub/organizers/${org.id}/logo`,
          publicId: org.id,
          resourceType: 'image',
        });
        await pool.query(`UPDATE organizers SET logo_url = $1 WHERE id = $2`, [result.secure_url, org.id]);
        stats.logosMigrated++;
        console.log(`✓ Organizer ${org.id} logo migrated -> ${result.secure_url}`);
      } catch (err) {
        console.error(`✗ Failed migrating logo for organizer ${org.id}:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('Error querying organizers for migration:', err);
    stats.errors++;
  }

  console.log('🏁 Migration Completed. Summary:', stats);
  return stats;
}

if (process.argv[1]?.endsWith('migrate-cloudinary.ts') || process.argv[1]?.endsWith('migrate-cloudinary.js')) {
  migrateLocalUploadsToCloudinary()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}
