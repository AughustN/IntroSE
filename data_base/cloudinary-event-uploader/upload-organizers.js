"use strict";

const fs = require("fs/promises");
const path = require("path");
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

const CSV_FILE = path.resolve(process.argv[2] || "organizer/organizers.csv");
const PROGRESS_FILE = path.resolve(__dirname, "upload-progress-organizers.json");
const OUTPUT_FILE = path.resolve(__dirname, "organizers_with_cloudinary.csv");
const CONCURRENCY = 5;
const UPLOAD_ATTEMPTS = 3;
const PROGRESS_RENAME_ATTEMPTS = 5;

cloudinary.config(CLOUDINARY_CONFIG);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function value(row, key) {
  return String(row[key] ?? "").trim();
}

function normalizeLocalPath(logoPath) {
  // CSV paths use Windows separators; resolve them relative to organizers.csv.
  return path.resolve(path.dirname(CSV_FILE), path.normalize(logoPath.replace(/\\/g, "/")));
}

function isRetryableUploadError(error) {
  const status = error.http_code || error.status || error.statusCode;
  if (status) return status === 408 || status === 429 || status >= 500;

  // SDK/network errors without an HTTP status are safe to retry.
  return true;
}

async function uploadWithRetry(source, options) {
  let lastError;

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await cloudinary.uploader.upload(source, options);
    } catch (error) {
      lastError = error;
      if (attempt === UPLOAD_ATTEMPTS || !isRetryableUploadError(error)) break;
      await sleep(750 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

async function loadProgress() {
  try {
    const data = JSON.parse(await fs.readFile(PROGRESS_FILE, "utf8"));
    const entries = Array.isArray(data) ? data : data.successful;
    const progress = new Map();

    for (const entry of entries || []) {
      if (typeof entry === "object" && entry !== null) {
        progress.set(String(entry.organizer_id), entry);
      } else {
        // Backward-compatible with a progress file containing only organizer IDs.
        progress.set(String(entry), { organizer_id: String(entry) });
      }
    }
    return progress;
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw new Error(`Cannot read progress file: ${error.message}`);
  }
}

async function renameWithRetry(tempFile, destination) {
  let lastError;
  for (let attempt = 1; attempt <= PROGRESS_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(tempFile, destination);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < PROGRESS_RENAME_ATTEMPTS) await sleep(100 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function createProgressWriter(progress) {
  let writeQueue = Promise.resolve();

  return function queueProgressWrite() {
    const writeTask = writeQueue.then(async () => {
      const tempFile = `${PROGRESS_FILE}.tmp`;
      const successful = [...progress.values()];
      await fs.writeFile(tempFile, `${JSON.stringify({ successful }, null, 2)}\n`, "utf8");
      await renameWithRetry(tempFile, PROGRESS_FILE);
    });
    // Keep the queue usable even if one write fails; that row is reported as an error,
    // while a later successful upload can still persist the current progress set.
    writeQueue = writeTask.catch(() => {});
    return writeTask;
  };
}

function uploadOptions(row, organizerId) {
  return {
    folder: "tixhub/organizers",
    public_id: organizerId,
    overwrite: true,
    resource_type: "image",
    tags: ["organizer-logo"],
    context: {
      organizer_id: organizerId,
      display_name: value(row, "display_name"),
    },
  };
}

async function main() {
  const csvText = await fs.readFile(CSV_FILE, "utf8");
  // `bom: true` removes UTF-8 BOM so the first header is organizer_id, not \ufefforganizer_id.
  const rows = parse(csvText, { bom: true, columns: true, skip_empty_lines: true });
  const originalColumns = Object.keys(rows[0] || {});
  const outputColumns = [...originalColumns, "cloudinary_public_id", "cloudinary_url"];
  const progress = await loadProgress();
  const queueProgressWrite = createProgressWriter(progress);
  const limit = pLimit(CONCURRENCY);
  const errors = [];
  let skippedNoLogo = 0;
  let skippedAlreadyUploaded = 0;
  let uploaded = 0;

  const results = await Promise.all(rows.map((row) => limit(async () => {
    const organizerId = value(row, "organizer_id");
    const logoPath = value(row, "logo_path");
    const logoUrl = value(row, "logo_url");
    const output = { ...row, cloudinary_public_id: "", cloudinary_url: "" };

    if (!organizerId) {
      const reason = "missing organizer_id";
      errors.push({ organizerId: "(missing)", reason });
      console.error(`[ERROR] organizer_id=(missing): ${reason}`);
      return output;
    }

    if (!logoPath && !logoUrl) {
      skippedNoLogo += 1;
      console.log(`[${organizerId}] skipped (no logo)`);
      return output;
    }

    const previous = progress.get(organizerId);
    if (previous) {
      skippedAlreadyUploaded += 1;
      output.cloudinary_public_id = previous.cloudinary_public_id || organizerId;
      output.cloudinary_url = previous.cloudinary_url || "";
      console.log(`[${organizerId}] skipped (already uploaded)`);
      return output;
    }

    try {
      let source = logoUrl;
      if (logoPath) {
        const localFile = normalizeLocalPath(logoPath);
        try {
          await fs.access(localFile);
          source = localFile;
        } catch {
          if (!logoUrl) throw new Error(`Local logo file not found: ${localFile}`);
          console.warn(`[${organizerId}] local file not found; using logo_url fallback`);
        }
      }

      const result = await uploadWithRetry(source, uploadOptions(row, organizerId));
      output.cloudinary_public_id = result.public_id;
      output.cloudinary_url = result.secure_url;
      progress.set(organizerId, {
        organizer_id: organizerId,
        cloudinary_public_id: result.public_id,
        cloudinary_url: result.secure_url,
      });
      await queueProgressWrite();
      uploaded += 1;
      console.log(`[${organizerId}] uploaded`);
    } catch (error) {
      const reason = error.message || String(error);
      errors.push({ organizerId, reason });
      console.error(`[ERROR] organizer_id=${organizerId}: ${reason}`);
    }

    return output;
  })));

  await fs.writeFile(OUTPUT_FILE, stringify(results, { header: true, columns: outputColumns }), "utf8");

  console.log("\nUpload summary");
  console.log(`Total rows: ${rows.length}`);
  console.log(`Uploaded successfully: ${uploaded}`);
  console.log(`Skipped: ${skippedNoLogo + skippedAlreadyUploaded} (no logo: ${skippedNoLogo}, already uploaded: ${skippedAlreadyUploaded})`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length) {
    console.log("Failed organizer IDs:");
    for (const { organizerId, reason } of errors) console.log(`- ${organizerId}: ${reason}`);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
});
