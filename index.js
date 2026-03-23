const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const { spawn } = require("child_process");
const chalk = require("chalk");
const express = require("express");

// =====================
// === SERVER SETUP  ===
// =====================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);
  const uptimeFormatted = `${hours.toString().padStart(2, "0")}h ${minutes
    .toString()
    .padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot Status</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Roboto+Mono&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
          color: #e0e0ff;
          font-family: 'Roboto Mono', monospace;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 20px;
          text-align: center;
        }
        .container {
          background: rgba(10, 10, 25, 0.7);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 40px 30px;
          box-shadow: 0 0 20px rgba(0,255,204,0.2), 0 0 40px rgba(0,255,204,0.1);
          max-width: 500px;
          width: 100%;
          border: 1px solid rgba(0,200,255,0.2);
        }
        h1 {
          font-family: 'Orbitron', sans-serif;
          font-size: 2.4em;
          margin-bottom: 30px;
          color: #00ffe5;
          text-shadow: 0 0 10px rgba(0,255,229,0.5);
          letter-spacing: 2px;
        }
        .status-card {
          background: rgba(0,25,40,0.6);
          padding: 20px;
          border-radius: 12px;
          margin: 15px 0;
          border-left: 4px solid #00ffcc;
        }
        .label {
          font-size: 0.9em;
          color: #8888cc;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 8px;
        }
        .value { font-size: 1.8em; font-weight: bold; }
        .uptime .value { color: #ffcc66; text-shadow: 0 0 8px rgba(255,204,102,0.4); }
        .status .value { color: #4dff91; text-shadow: 0 0 8px rgba(77,255,145,0.4); }
        .pulse {
          display: inline-block;
          width: 12px; height: 12px;
          background: #4dff91;
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; }
        }
        @media (max-width: 480px) {
          h1 { font-size: 2em; }
          .value { font-size: 1.5em; }
          .container { padding: 30px 20px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>TRASHCORE STATUS</h1>
        <div class="status-card uptime">
          <div class="label">Uptime</div>
          <div class="value">${uptimeFormatted}</div>
        </div>
        <div class="status-card status">
          <div class="label">Status</div>
          <div class="value"><span class="pulse"></span>Online</div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(chalk.green(`🌐 Server running on port ${PORT}`));
});

// =====================
// === PATH CONFIG   ===
// =====================
const deepLayers = Array.from({ length: 50 }, (_, i) => `.x${i + 1}`);
const TEMP_DIR = path.join(__dirname, ".npm", "xcache", ...deepLayers);
const EXTRACT_DIR = path.join(TEMP_DIR, "bot-main");
const ZIP_PATH = path.join(TEMP_DIR, "bot.zip");
const LOCAL_SETTINGS = path.join(__dirname, "config.js");
const EXTRACTED_SETTINGS = path.join(EXTRACT_DIR, "config.js");

// =====================
// === TELEGRAM CFG  ===
// =====================
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_FILE_ID = process.env.TG_FILE_ID;

if (!TG_BOT_TOKEN || !TG_FILE_ID) {
  console.error(
    chalk.red("❌ Missing TG_BOT_TOKEN or TG_FILE_ID in environment variables.")
  );
  process.exit(1);
}

// =====================
// === HELPERS       ===
// =====================
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Cache SHA based on Telegram file_id so we don't re-download unnecessarily
function readCachedFileId() {
  const cacheFile = path.join(TEMP_DIR, "tg_file.id");
  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile, "utf-8").trim();
  }
  return null;
}

function saveCachedFileId(fileId) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEMP_DIR, "tg_file.id"), fileId);
}

// =====================
// === DOWNLOAD      ===
// =====================
async function downloadFromTelegram(force = false) {
  try {
    const cachedFileId = readCachedFileId();

    if (
      !force &&
      fs.existsSync(EXTRACT_DIR) &&
      cachedFileId === TG_FILE_ID
    ) {
      console.log(chalk.green("✅ Bot is up-to-date, skipping download."));
      return;
    }

    console.log(chalk.yellow("📡 Fetching file info from Telegram..."));

    // Step 1: Get the file path from Telegram
    const infoRes = await axios.get(
      `https://api.telegram.org/bot${TG_BOT_TOKEN}/getFile?file_id=${TG_FILE_ID}`
    );

    if (!infoRes.data.ok) {
      throw new Error(`Telegram getFile failed: ${JSON.stringify(infoRes.data)}`);
    }

    const tgFilePath = infoRes.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${tgFilePath}`;

    console.log(chalk.yellow("📥 Downloading bot ZIP from Telegram..."));

    // Step 2: Download the ZIP
    const response = await axios({
      url: downloadUrl,
      method: "GET",
      responseType: "stream",
    });

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const writer = fs.createWriteStream(ZIP_PATH);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log(chalk.cyan("📤 Extracting bot files..."));

    // Step 3: Clean old extract and unzip
    if (fs.existsSync(EXTRACT_DIR)) {
      fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
    }

    const zip = new AdmZip(ZIP_PATH);
    zip.extractAllTo(TEMP_DIR, true);

    // Step 4: Auto-detect extracted folder name (handles any zip structure)
    const entries = fs.readdirSync(TEMP_DIR).filter((f) => {
      const full = path.join(TEMP_DIR, f);
      return fs.statSync(full).isDirectory() && f !== "xcache";
    });

    if (entries.length > 0) {
      const extractedName = path.join(TEMP_DIR, entries[0]);
      if (extractedName !== EXTRACT_DIR) {
        fs.renameSync(extractedName, EXTRACT_DIR);
      }
    }

    saveCachedFileId(TG_FILE_ID);
    console.log(chalk.green("✅ Bot files downloaded and extracted."));
  } catch (e) {
    console.error(chalk.red("❌ Download/Extract failed:"), e.message || e);
    throw e;
  }
}

// =====================
// === APPLY SETTINGS===
// =====================
async function applyLocalSettings() {
  if (!fs.existsSync(LOCAL_SETTINGS)) {
    console.log(chalk.yellow("⚠️ No local config.js found, skipping."));
    return;
  }

  try {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
    fs.copyFileSync(LOCAL_SETTINGS, EXTRACTED_SETTINGS);
    console.log(chalk.green("🛠️ Local config.js applied."));
  } catch (e) {
    console.error(chalk.red("❌ Failed to apply local settings:"), e.message);
  }

  await delay(500);
}

// =====================
// === START BOT     ===
// =====================
function startBot() {
  console.log(chalk.cyan("🚀 Launching bot instance..."));

  if (!fs.existsSync(EXTRACT_DIR)) {
    console.error(chalk.red("❌ Extracted directory not found. Cannot start bot."));
    return;
  }

  const mainFile = path.join(EXTRACT_DIR, "index.js");
  if (!fs.existsSync(mainFile)) {
    console.error(chalk.red("❌ index.js not found in extracted directory."));
    return;
  }

  const bot = spawn("node", ["index.js"], {
    cwd: EXTRACT_DIR,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });

  bot.on("close", (code) => {
    console.log(chalk.red(`💥 Bot exited with code: ${code}`));
  });

  bot.on("error", (err) => {
    console.error(chalk.red("❌ Bot failed to start:"), err.message);
  });
}

// =====================
// === MAIN          ===
// =====================
(async () => {
  try {
    await downloadFromTelegram();
    await applyLocalSettings();
    startBot();
  } catch (e) {
    console.error(chalk.red("❌ Fatal error:"), e.message || e);
    process.exit(1);
  }
})();
 
