#!/usr/bin/env node

/**
 * Normalize generated Smart Phonics word audio (audio/words/*.mp3) and
 * player turn announcements (audio/players/*.mp3) to match the perceived
 * loudness of the original SmartPhonics studio MP3s (~ -14.4 LUFS).
 *
 * Uses ffmpeg speechnorm + iterative gain/lookahead-limiter so short clips
 * reach consistent loudness cleanly without clipping (TP <= -0.5 dBTP).
 *
 * Usage:
 *   node scripts/normalize-audio.js check              # Inspect loudness stats
 *   node scripts/normalize-audio.js words              # Normalize audio/words/*.mp3
 *   node scripts/normalize-audio.js players            # Normalize audio/players/*.mp3
 *   node scripts/normalize-audio.js all                # Normalize both directories
 *   node scripts/normalize-audio.js all --force        # Re-normalize even if within tolerance
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const WORDS_DIR = path.join(ROOT_DIR, "audio", "words");
const PLAYERS_DIR = path.join(ROOT_DIR, "audio", "players");

// Original SmartPhonics word MP3s (Books 1 Vocab + Books 2-5, n=414):
//   median = -14.41 LUFS, mean = -14.46 LUFS (Books 2-4 medians: -14.68 to -14.46 LUFS).
// Targeting -14.2 LUFS in lossless intermediate lands encoded MP3s right around -14.4 LUFS.
export const TARGET_WAV_LUFS = -14.2;
export const TARGET_DISPLAY_LUFS = -14.4;
export const TOLERANCE_LUFS = 0.4;
export const MAX_TRUE_PEAK_DBTP = -0.5;
const ALIMITER_CEILING_LINEAR = 0.851; // ~ -1.4 dBFS to leave headroom for MP3 inter-sample peaks
const MAX_EXTRA_LIMITER_DRIVE_DB = 4.5;

let tmpCounter = 0;

export async function hasFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function measureLoudness(filePath) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-i",
    filePath,
    "-af",
    `loudnorm=I=${TARGET_WAV_LUFS}:TP=-1.0:LRA=11:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) {
    throw new Error(`Could not parse ffmpeg loudnorm JSON for ${path.basename(filePath)}`);
  }
  const parsed = JSON.parse(match[0]);
  const inputI = parseFloat(parsed.input_i);
  const inputTp = parseFloat(parsed.input_tp);
  if (!Number.isFinite(inputI) || !Number.isFinite(inputTp)) {
    throw new Error(`Non-finite loudness metrics for ${path.basename(filePath)}: I=${parsed.input_i}, TP=${parsed.input_tp}`);
  }
  return {
    lufs: inputI,
    tp: inputTp,
    lra: parseFloat(parsed.input_lra),
  };
}

function makeTempPath(ext) {
  tmpCounter += 1;
  return path.join(os.tmpdir(), `aem-norm-${process.pid}-${Date.now()}-${tmpCounter}.${ext}`);
}

/**
 * Normalize a single MP3 file in place to match the SmartPhonics reference loudness.
 * Returns { skipped, before, after }.
 */
export async function normalizeMp3File(filePath, { force = false, dryRun = false } = {}) {
  const before = await measureLoudness(filePath);
  const withinLufs = Math.abs(before.lufs - TARGET_DISPLAY_LUFS) <= TOLERANCE_LUFS;
  const safePeak = before.tp <= MAX_TRUE_PEAK_DBTP;

  if (!force && withinLufs && safePeak) {
    return { skipped: true, before, after: before };
  }

  if (dryRun) {
    return { skipped: false, dryRun: true, before, after: before };
  }

  const snWav = makeTempPath("wav");
  const limWav = makeTempPath("wav");
  const outMp3 = makeTempPath("mp3");

  try {
    // Stage 1: Gentle speech leveling (ignores silence below -34 dB)
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-af",
      "speechnorm=p=0.89:e=3.5:c=2:t=0.02:r=0.005:f=0.005",
      snWav,
    ]);

    const mSn = await measureLoudness(snWav);
    const baseDelta = TARGET_WAV_LUFS - mSn.lufs;
    let gainDb = baseDelta;

    // Stage 2: Converge to TARGET_WAV_LUFS with clean lookahead limiting
    for (let step = 0; step < 4; step++) {
      await execFileAsync("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        snWav,
        "-af",
        `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${ALIMITER_CEILING_LINEAR}:attack=5:release=50:level=disabled:latency=true`,
        limWav,
      ]);

      const cur = await measureLoudness(limWav);
      const err = TARGET_WAV_LUFS - cur.lufs;
      if (Math.abs(err) <= 0.1) break;

      const nextGain = Math.min(gainDb + err * 1.25, baseDelta + MAX_EXTRA_LIMITER_DRIVE_DB);
      if (Math.abs(nextGain - gainDb) < 0.05) break;
      gainDb = nextGain;
    }

    // Stage 3: Re-encode MP3 matching ElevenLabs format (44.1kHz, 128kbps)
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      limWav,
      "-ar",
      "44100",
      "-b:a",
      "128k",
      outMp3,
    ]);

    const stat = fs.statSync(outMp3);
    if (!stat.size) {
      throw new Error(`Normalized output empty for ${path.basename(filePath)}`);
    }

    const after = await measureLoudness(outMp3);
    const dirTmp = `${filePath}.normtmp.${process.pid}.mp3`;
    fs.copyFileSync(outMp3, dirTmp);
    fs.renameSync(dirTmp, filePath);

    return { skipped: false, before, after };
  } finally {
    for (const p of [snWav, limWav, outMp3]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore temp cleanup failure
      }
    }
  }
}

async function runPool(items, concurrency, fn) {
  let idx = 0;
  const results = new Array(items.length);
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function summarize(label, metrics) {
  if (metrics.length === 0) {
    console.log(`${label}: no files`);
    return;
  }
  const lufs = metrics.map((m) => m.lufs).sort((a, b) => a - b);
  const tps = metrics.map((m) => m.tp).sort((a, b) => a - b);
  const med = (arr) => arr[Math.floor(arr.length / 2)];
  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  console.log(
    `${label} (n=${metrics.length}): LUFS min=${lufs[0].toFixed(2)}, med=${med(lufs).toFixed(2)}, mean=${mean(lufs).toFixed(2)}, max=${lufs[lufs.length - 1].toFixed(2)} | TP med=${med(tps).toFixed(2)}, max=${tps[tps.length - 1].toFixed(2)} dBTP`
  );
}

function collectMp3s(scope) {
  const dirs = [];
  if (scope === "words" || scope === "all") dirs.push(WORDS_DIR);
  if (scope === "players" || scope === "all") dirs.push(PLAYERS_DIR);

  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      if (entry.endsWith(".mp3")) {
        files.push(path.join(dir, entry));
      }
    }
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "all";
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const concIdx = args.indexOf("--concurrency");
  const concurrency = concIdx !== -1 && args[concIdx + 1] ? Math.max(1, parseInt(args[concIdx + 1], 10) || 8) : 8;

  if (!(await hasFfmpeg())) {
    console.error("Error: ffmpeg is not installed or not in PATH.");
    process.exit(1);
  }

  if (cmd === "check") {
    const words = collectMp3s("words");
    const players = collectMp3s("players");
    console.log(`[Normalize Audio] Measuring ${words.length} word files and ${players.length} player files...`);
    const wm = await runPool(words, concurrency, (f) => measureLoudness(f));
    const pm = await runPool(players, concurrency, (f) => measureLoudness(f));
    summarize("audio/words  ", wm);
    summarize("audio/players", pm);
    return;
  }

  if (!["words", "players", "all"].includes(cmd)) {
    console.error("Usage: node scripts/normalize-audio.js [check|words|players|all] [--force] [--dry-run] [--concurrency N]");
    process.exit(1);
  }

  const files = collectMp3s(cmd);
  console.log(`[Normalize Audio] Target ~ ${TARGET_DISPLAY_LUFS} LUFS (matching original SmartPhonics). Processing ${files.length} files (concurrency=${concurrency}, force=${force}, dryRun=${dryRun})...`);

  let done = 0;
  let updated = 0;
  let skipped = 0;

  const outcomes = await runPool(files, concurrency, async (f) => {
    const res = await normalizeMp3File(f, { force, dryRun });
    done++;
    if (res.skipped) skipped++;
    else updated++;

    if (done % 100 === 0 || done === files.length) {
      console.log(`  [${done}/${files.length}] updated=${updated}, skipped=${skipped}`);
    }
    return { file: f, ...res };
  });

  const wordResults = outcomes.filter((o) => o.file.startsWith(WORDS_DIR));
  const playerResults = outcomes.filter((o) => o.file.startsWith(PLAYERS_DIR));

  console.log("\n── Loudness Summary ────────────────────────────────────");
  if (wordResults.length > 0) {
    summarize("audio/words   before", wordResults.map((r) => r.before));
    summarize("audio/words   after ", wordResults.map((r) => r.after));
  }
  if (playerResults.length > 0) {
    summarize("audio/players before", playerResults.map((r) => r.before));
    summarize("audio/players after ", playerResults.map((r) => r.after));
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[Normalize Audio] Fatal error:", err);
    process.exit(1);
  });
}
