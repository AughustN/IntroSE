"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { v2: cloudinary } = require("cloudinary");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const pLimit = require("p-limit");
const { Pool } = require("pg");
const dotenv = require("dotenv");

// Load .env from current directory or source/IntroSE/.env
dotenv.config();
const envPath = path.resolve(__dirname, "..", "source", "IntroSE", ".env");
dotenv.config({ path: envPath });

const CLOUDINARY_CONFIG = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};

if (!CLOUDINARY_CONFIG.cloud_name || !CLOUDINARY_CONFIG.api_key || !CLOUDINARY_CONFIG.api_secret) {
  console.error("Error: Missing Cloudinary credentials.");
  console.error("Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your environment or .env file.");
  process.exit(1);
}

cloudinary.config(CLOUDINARY_CONFIG);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MOVIES_DIR = path.resolve(PROJECT_ROOT, "data", "movies");
const CSV_PATH = path.resolve(MOVIES_DIR, "events.csv");
const PROGRESS_PATH = path.resolve(MOVIES_DIR, "upload-progress.json");
const OUTPUT_PATH = path.resolve(MOVIES_DIR, "events_with_cloudinary.csv");

const CONCURRENCY = 3; // 3 concurrent workers to balance image & video uploads
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readCsv(csvPath) {
  const contents = await fs.readFile(csvPath, "utf8");
  return parse(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
  });
}

async function readProgress(progressPath) {
  try {
    const progress = JSON.parse(await fs.readFile(progressPath, "utf8"));
    if (progress && typeof progress.banners === "object" && typeof progress.trailers === "object") {
      return progress;
    }
    return { banners: progress.banners || {}, trailers: progress.trailers || {} };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { banners: {}, trailers: {} };
    }
    throw new Error(`Cannot read ${progressPath}: ${error.message}`);
  }
}

function createProgressWriter(progressPath, progress) {
  let writeQueue = Promise.resolve();

  return {
    save() {
      writeQueue = writeQueue.then(async () => {
        const temporaryPath = `${progressPath}.tmp`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
        await fs.rename(temporaryPath, progressPath);
      });
      return writeQueue;
    },
    finish() {
      return writeQueue;
    },
  };
}

async function uploadWithRetry(uploadSource, options, eventId, assetType) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await cloudinary.uploader.upload(uploadSource, options);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = 1500 * 2 ** (attempt - 1);
        console.warn(`[Event ${eventId}] [${assetType}] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

async function main() {
  console.log("=== Starting TixHub Movie Batch Cloudinary Uploader ===");
  console.log(`Cloudinary Cloud: ${CLOUDINARY_CONFIG.cloud_name}`);
  console.log(`Target CSV: ${CSV_PATH}`);

  const events = await readCsv(CSV_PATH);
  console.log(`Loaded ${events.length} movie event records.`);

  const progress = await readProgress(PROGRESS_PATH);
  const progressWriter = createProgressWriter(PROGRESS_PATH, progress);
  const limit = pLimit(CONCURRENCY);

  let bannerSuccess = 0;
  let bannerSkipped = 0;
  let trailerSuccess = 0;
  let trailerSkipped = 0;
  const failures = [];

  await Promise.all(
    events.map((event) =>
      limit(async () => {
        const eventId = event.id;
        const bannerFolder = `tixhub/events/${eventId}/banner`;
        const trailerFolder = `tixhub/events/${eventId}/trailer`;

        // 1. Upload Banner Poster
        if (progress.banners[eventId]) {
          bannerSkipped += 1;
        } else {
          try {
            let localBannerPath = "";
            if (event.image_url && !event.image_url.startsWith("http")) {
              localBannerPath = path.resolve(PROJECT_ROOT, event.image_url);
            }
            const bannerSource = (localBannerPath && (await fileExists(localBannerPath)))
              ? localBannerPath
              : event.image_url;

            if (bannerSource && bannerSource !== "NULL" && bannerSource.trim() !== "") {
              const res = await uploadWithRetry(
                bannerSource,
                {
                  folder: bannerFolder,
                  public_id: String(eventId),
                  unique_filename: false,
                  overwrite: true,
                  resource_type: "image",
                  tags: ["movie-banner", "event-banner", "movie"],
                  context: {
                    event_id: eventId,
                    title: event.title || "",
                  },
                },
                eventId,
                "banner"
              );

              progress.banners[eventId] = {
                public_id: res.public_id,
                secure_url: res.secure_url,
                uploaded_at: new Date().toISOString(),
              };
              await progressWriter.save();
              bannerSuccess += 1;
              console.log(`[Event ${eventId}] Banner uploaded -> ${res.secure_url}`);
            }
          } catch (err) {
            const reason = `Banner upload failed: ${err.message || String(err)}`;
            failures.push({ eventId, type: "banner", reason });
            console.error(`[Event ${eventId}] ${reason}`);
          }
        }

        // 2. Upload Trailer Video (if available)
        if (progress.trailers[eventId]) {
          trailerSkipped += 1;
        } else {
          try {
            let localTrailerPath = "";
            if (event.trailer_url && !event.trailer_url.startsWith("http")) {
              localTrailerPath = path.resolve(PROJECT_ROOT, event.trailer_url);
            }

            const trailerSource = (localTrailerPath && (await fileExists(localTrailerPath)))
              ? localTrailerPath
              : (event.trailer_url && event.trailer_url.startsWith("http") && !event.trailer_url.includes("youtube.com") && !event.trailer_url.includes("youtu.be"))
                ? event.trailer_url
                : "";

            if (trailerSource && trailerSource !== "NULL" && trailerSource.trim() !== "") {
              const res = await uploadWithRetry(
                trailerSource,
                {
                  folder: trailerFolder,
                  public_id: String(eventId),
                  unique_filename: false,
                  overwrite: true,
                  resource_type: "video",
                  tags: ["movie-trailer", "event-trailer", "movie"],
                  context: {
                    event_id: eventId,
                    title: event.title || "",
                  },
                },
                eventId,
                "trailer"
              );

              progress.trailers[eventId] = {
                public_id: res.public_id,
                secure_url: res.secure_url,
                uploaded_at: new Date().toISOString(),
              };
              await progressWriter.save();
              trailerSuccess += 1;
              console.log(`[Event ${eventId}] Trailer uploaded -> ${res.secure_url}`);
            }
          } catch (err) {
            const reason = `Trailer upload failed: ${err.message || String(err)}`;
            failures.push({ eventId, type: "trailer", reason });
            console.error(`[Event ${eventId}] ${reason}`);
          }
        }
      })
    )
  );

  await progressWriter.finish();

  console.log("\n=== Cloudinary Upload Summary ===");
  console.log(`Total Events: ${events.length}`);
  console.log(`Banners Uploaded: ${bannerSuccess} (Skipped: ${bannerSkipped})`);
  console.log(`Trailers Uploaded: ${trailerSuccess} (Skipped: ${trailerSkipped})`);
  console.log(`Failures: ${failures.length}`);

  // Update CSV and DB with Secure Cloudinary URLs
  console.log("\n--- Updating Consolidated CSVs & Neon Database with Cloudinary URLs ---");
  const updatedEvents = events.map((event) => {
    const banner = progress.banners[event.id];
    const trailer = progress.trailers[event.id];

    return {
      ...event,
      image_url: banner ? banner.secure_url : event.image_url,
      trailer_url: trailer ? trailer.secure_url : event.trailer_url,
      cloudinary_banner_public_id: banner ? banner.public_id : "",
      cloudinary_banner_url: banner ? banner.secure_url : "",
      cloudinary_trailer_public_id: trailer ? trailer.public_id : "",
      cloudinary_trailer_url: trailer ? trailer.secure_url : "",
    };
  });

  // Write events_with_cloudinary.csv
  const headers = Object.keys(updatedEvents[0]);
  const csvWithCloudinary = stringify(updatedEvents, { header: true, columns: headers });
  await fs.writeFile(OUTPUT_PATH, csvWithCloudinary, "utf8");
  console.log(`Written ${OUTPUT_PATH}`);

  // Update main events.csv, movies.csv, and events_import_compact.csv
  const standardCols = ['id', 'slug', 'organizer_id', 'category_id', 'title', 'original_title', 'description', 'age_restriction', 'age_description', 'duration_minutes', 'genre', 'lineup', 'image_url', 'trailer_url', 'refund_policy', 'is_featured', 'event_type', 'status', 'moderation_status', 'review_note', 'seo_title', 'seo_description', 'created_at', 'updated_at'];
  const cleanUpdatedEvents = updatedEvents.map(e => {
    const o = {};
    for (const k of standardCols) o[k] = e[k];
    return o;
  });
  const standardCsv = stringify(cleanUpdatedEvents, { header: true, columns: standardCols });
  await fs.writeFile(CSV_PATH, standardCsv, "utf8");
  await fs.writeFile(path.resolve(MOVIES_DIR, "movies.csv"), standardCsv, "utf8");

  const compactRows = updatedEvents.map(e => ({
    id: e.id,
    slug: e.slug,
    organizer_id: e.organizer_id,
    category_id: e.category_id,
    title: e.title,
    description: e.description,
    image_url: e.image_url,
    event_type: e.event_type,
    status: e.status,
    moderation_status: e.moderation_status
  }));
  const compactCsv = stringify(compactRows, { header: true, columns: Object.keys(compactRows[0]) });
  await fs.writeFile(path.resolve(MOVIES_DIR, "events_import_compact.csv"), compactCsv, "utf8");

  // Update Database
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    try {
      console.log("Connecting to Neon DB to update image_url and trailer_url...");
      for (const e of cleanUpdatedEvents) {
        await pool.query(
          "UPDATE public.events SET image_url = $1, trailer_url = $2, updated_at = now() WHERE id = $3",
          [e.image_url, e.trailer_url, e.id]
        );
      }
      console.log("Successfully updated all movie events in Neon Database with Cloudinary URLs!");
    } catch (dbErr) {
      console.error("DB update error:", dbErr.message);
    } finally {
      await pool.end();
    }
  }

  console.log("=== All Movie Upload & Sync Operations Completed Successfully ===");
}

main().catch((err) => {
  console.error("Fatal error in uploader:", err);
  process.exitCode = 1;
});
