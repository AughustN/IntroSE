"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { v2: cloudinary } = require("cloudinary");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const pLimit = require("p-limit");
const dotenv = require("dotenv");

// Load .env from current directory or project root
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "..", "source", "IntroSE", ".env") });

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

const UPLOAD_FOLDER = "tixhub/events";
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;

cloudinary.config(CLOUDINARY_CONFIG);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    if (progress && typeof progress.uploads === "object" && progress.uploads !== null) {
      return progress;
    }
    throw new Error("missing uploads object");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { uploads: {} };
    }
    throw new Error(`Cannot read ${progressPath}: ${error.message}`);
  }
}

function createProgressWriter(progressPath, progress) {
  let writeQueue = Promise.resolve();

  return {
    save() {
      // Serializing writes prevents concurrent uploads from corrupting this file.
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

async function uploadWithRetry(uploadSource, options, eventId) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await cloudinary.uploader.upload(uploadSource, options);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = 1000 * 2 ** (attempt - 1);
        console.warn(`[${eventId}] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function validateRow(row, rowNumber) {
  if (!row.event_id) {
    throw new Error(`Row ${rowNumber} has no event_id`);
  }
}

async function main() {
  // Pass a CSV path as the first argument, or run from the CSV directory.
  const csvPath = path.resolve(process.argv[2] || "events.csv");
  const csvDirectory = path.dirname(csvPath);
  const progressPath = path.join(csvDirectory, "upload-progress.json");
  const outputPath = path.join(csvDirectory, "events_with_cloudinary.csv");

  const events = await readCsv(csvPath);
  events.forEach(validateRow);
  const progress = await readProgress(progressPath);
  const progressWriter = createProgressWriter(progressPath, progress);
  const limit = pLimit(CONCURRENCY);
  const failures = [];
  let successful = 0;
  let skipped = 0;

  console.log(`Read ${events.length} events from ${csvPath}`);

  await Promise.all(
    events.map((event) =>
      limit(async () => {
        const eventId = event.event_id;
        if (progress.uploads[eventId]) {
          skipped += 1;
          return;
        }

        try {
          const localPath = event.local_image
            ? path.resolve(csvDirectory, event.local_image)
            : "";
          const uploadSource = (localPath && (await fileExists(localPath)))
            ? localPath
            : event.image_url;

          if (!uploadSource) {
            throw new Error("Local image does not exist and image_url is empty");
          }

          const result = await uploadWithRetry(uploadSource, {
            folder: UPLOAD_FOLDER,
            public_id: eventId,
            unique_filename: false,
            overwrite: true,
            resource_type: "image",
            tags: ["event-banner", event.source || "unknown"],
            context: {
              event_id: eventId,
              event_name: event.event_name || "",
            },
          }, eventId);

          progress.uploads[eventId] = {
            public_id: result.public_id,
            secure_url: result.secure_url,
            uploaded_at: new Date().toISOString(),
          };
          await progressWriter.save();
          successful += 1;
          console.log(`[${eventId}] Uploaded`);
        } catch (error) {
          const reason = error.message || String(error);
          failures.push({ eventId, reason });
          console.error(`[${eventId}] Failed: ${reason}`);
        }
      }),
    ),
  );

  await progressWriter.finish();

  const outputRows = events.map((event) => {
    const upload = progress.uploads[event.event_id];
    return {
      ...event,
      cloudinary_public_id: upload?.public_id || "",
      cloudinary_url: upload?.secure_url || "",
    };
  });
  const originalColumns = events.length > 0 ? Object.keys(events[0]) : [];
  const csv = stringify(outputRows, {
    header: true,
    columns: [...originalColumns, "cloudinary_public_id", "cloudinary_url"],
  });
  await fs.writeFile(outputPath, csv, "utf8");

  console.log("\nUpload summary");
  console.log(`Total images: ${events.length}`);
  console.log(`Uploaded this run: ${successful}`);
  console.log(`Skipped from progress: ${skipped}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Output CSV: ${outputPath}`);

  if (failures.length > 0) {
    console.error("\nFailed event IDs:");
    failures.forEach(({ eventId, reason }) => console.error(`- ${eventId}: ${reason}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
});
