#!/usr/bin/env node

/**
 * Manage and synchronize player turn announcement audio files via ElevenLabs.
 *
 * Enforces project policies (from elevenlabs-voice-synthesis skill):
 * - Model: eleven_v4_turbo
 * - Speed: 0.85
 * - Korean Pronunciation Dictionary: sKcMTMc7IZdOIqGSuKGL (v: lBWAKvEKQsfx4Ajakhf7)
 * - Approved American voice roster (rotates 3 voices per student, at least 1 boy and 1 girl)
 *
 * Usage:
 *   node scripts/manage-player-audio.js check        # Inspect missing and orphaned student audio
 *   node scripts/manage-player-audio.js sync         # Download missing audio and remove orphaned audio
 *   node scripts/manage-player-audio.js clean        # Remove orphaned audio only
 *   node scripts/manage-player-audio.js generate     # Generate missing audio
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const AUDIO_DIR = path.join(ROOT_DIR, "audio", "players");
const MANIFEST_PATH = path.join(AUDIO_DIR, "manifest.json");

// Project Policy Enforcements
const ELEVENLABS_MODEL_ID = "eleven_v4_turbo";
const ELEVENLABS_SPEED = 0.85;
const ELEVENLABS_PRONUNCIATION_DICT_ID = "sKcMTMc7IZdOIqGSuKGL";
const ELEVENLABS_PRONUNCIATION_VERSION_ID = "lBWAKvEKQsfx4Ajakhf7";

const DEFAULT_CONVEX_URL = "https://shiny-tapir-482.ap-southeast-2.convex.cloud";
const DEFAULT_SYNC_CODE = "all english";
const DEFAULT_SYNC_PIN = "1331";

// Approved American Voices
const FEMALE_VOICES = [
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "FEMALE" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "FEMALE" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", gender: "FEMALE" },
  { id: "Z3R5wn05IrDiVCyEkUrK", name: "Arabella", gender: "FEMALE" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "FEMALE" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "FEMALE" },
];

const MALE_VOICES = [
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "MALE" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "MALE" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "MALE" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", gender: "MALE" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", gender: "MALE" },
];

const VARIATIONS = [
  {
    version: 1,
    suffix: "_v1.mp3",
    style: "friendly",
    getText: (name) => `[friendly] ${name}'s turn!`,
  },
  {
    version: 2,
    suffix: "_v2.mp3",
    style: "excited",
    getText: (name) => `[excited] It's ${name}'s turn!`,
  },
  {
    version: 3,
    suffix: "_v3.mp3",
    style: "playful",
    getText: (name) => `[playful] Your turn, ${name}!`,
  },
];

export function toStudentSlug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
}

function getVoicePlanForStudent(studentName, index) {
  // Guarantee both genders for every student by alternating patterns:
  // Even index: Female 1, Male 1, Female 2
  // Odd index:  Male 1, Female 1, Male 2
  let voiceTrio;
  if (index % 2 === 0) {
    const f1 = FEMALE_VOICES[index % FEMALE_VOICES.length];
    const m1 = MALE_VOICES[index % MALE_VOICES.length];
    const f2 = FEMALE_VOICES[(index + 1) % FEMALE_VOICES.length];
    voiceTrio = [f1, m1, f2];
  } else {
    const m1 = MALE_VOICES[index % MALE_VOICES.length];
    const f1 = FEMALE_VOICES[index % FEMALE_VOICES.length];
    const m2 = MALE_VOICES[(index + 1) % MALE_VOICES.length];
    voiceTrio = [m1, f1, m2];
  }

  const slug = toStudentSlug(studentName);
  return VARIATIONS.map((v, vIdx) => {
    const voice = voiceTrio[vIdx];
    const fileName = `${slug}${v.suffix}`;
    return {
      studentName,
      slug,
      version: v.version,
      style: v.style,
      fileName,
      filePath: path.join(AUDIO_DIR, fileName),
      voice,
      text: v.getText(studentName),
    };
  });
}

async function fetchEnrolledStudents(syncCode, pin, convexUrl) {
  const endpoint = `${convexUrl.replace(/\/$/, "")}/api/query`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "sync:getWorkspaceSnapshot",
      args: { syncCode, pin },
      format: "json",
    }),
  });

  if (!res.ok) {
    throw new Error(`Convex query failed with HTTP status ${res.status}`);
  }

  const data = await res.json();
  if (data.status === "error") {
    throw new Error(data.errorMessage || "Convex error");
  }

  const snapshot = data.value?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.classes)) {
    throw new Error(data.value?.message || "Could not retrieve workspace classes.");
  }

  const studentSet = new Set();
  for (const cls of snapshot.classes) {
    for (const player of cls.players || []) {
      const clean = String(player || "").trim();
      if (clean) studentSet.add(clean);
    }
  }

  // Sort case-insensitively
  return Array.from(studentSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function analyzeAudioFiles(students) {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  const existingFiles = new Set(
    fs
      .readdirSync(AUDIO_DIR)
      .filter((f) => f.endsWith(".mp3"))
  );

  const plannedItems = [];
  const expectedFileNames = new Set();
  const studentManifest = {};

  students.forEach((student, index) => {
    const plan = getVoicePlanForStudent(student, index);
    const slug = toStudentSlug(student);
    studentManifest[student] = {
      slug,
      files: plan.map((p) => `audio/players/${p.fileName}`),
      variations: plan.map((p) => ({
        version: p.version,
        style: p.style,
        file: p.fileName,
        voice: p.voice,
        text: p.text,
      })),
    };

    for (const item of plan) {
      plannedItems.push(item);
      expectedFileNames.add(item.fileName);
    }
  });

  const missing = plannedItems.filter((item) => !existingFiles.has(item.fileName));
  const orphaned = Array.from(existingFiles).filter(
    (fileName) => !expectedFileNames.has(fileName)
  );

  return {
    students,
    plannedItems,
    existingFiles,
    missing,
    orphaned,
    studentManifest,
  };
}

async function synthesizeToFile(item, apiKey) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${item.voice.id}`;
  const payload = {
    text: item.text,
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      speed: ELEVENLABS_SPEED,
    },
    pronunciation_dictionary_locators: [
      {
        pronunciation_dictionary_id: ELEVENLABS_PRONUNCIATION_DICT_ID,
        version_id: ELEVENLABS_PRONUNCIATION_VERSION_ID,
      },
    ],
  };

  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(item.filePath, buffer);
      return buffer.length;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`[Retry ${attempt}] ${item.fileName}: ${err.message}. Waiting 1s...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function writeManifest(manifestData) {
  const content = {
    updatedAt: Date.now(),
    updatedAtISO: new Date().toISOString(),
    totalStudents: Object.keys(manifestData).length,
    students: manifestData,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(content, null, 2));
}

// ── CLI Main ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "sync";
  const force = args.includes("--force");

  const syncCode =
    process.env.SYNC_CODE ||
    args.find((a, i) => args[i - 1] === "--code") ||
    DEFAULT_SYNC_CODE;

  const pin =
    process.env.SYNC_PIN ||
    args.find((a, i) => args[i - 1] === "--pin") ||
    DEFAULT_SYNC_PIN;

  const convexUrl =
    process.env.CONVEX_URL ||
    args.find((a, i) => args[i - 1] === "--convex-url") ||
    DEFAULT_CONVEX_URL;

  console.log(`[Player Audio] Fetching active classes from Convex ("${syncCode}")...`);
  const students = await fetchEnrolledStudents(syncCode, pin, convexUrl);
  console.log(`[Player Audio] Found ${students.length} enrolled students across classes.`);

  const analysis = analyzeAudioFiles(students);

  if (command === "check") {
    console.log(`\n── Status Check ──────────────────────────────`);
    console.log(`Enrolled students:   ${analysis.students.length}`);
    console.log(`Expected audio:      ${analysis.plannedItems.length} (3 per student)`);
    console.log(`Existing audio:      ${analysis.existingFiles.size}`);
    console.log(`Missing audio:       ${analysis.missing.length}`);
    console.log(`Orphaned audio:      ${analysis.orphaned.length}`);

    if (analysis.missing.length > 0) {
      console.log(`\nMissing files (${analysis.missing.length}):`);
      analysis.missing.forEach((m) =>
        console.log(` - ${m.fileName} (${m.studentName} [${m.voice.name}] "${m.text}")`)
      );
    }
    if (analysis.orphaned.length > 0) {
      console.log(`\nOrphaned files to remove (${analysis.orphaned.length}):`);
      analysis.orphaned.forEach((o) => console.log(` - ${o}`));
    }
    return;
  }

  if (command === "clean" || command === "sync") {
    if (analysis.orphaned.length > 0) {
      console.log(`\n[Player Audio] Removing ${analysis.orphaned.length} orphaned audio file(s)...`);
      for (const fileName of analysis.orphaned) {
        const filePath = path.join(AUDIO_DIR, fileName);
        try {
          fs.unlinkSync(filePath);
          console.log(`  ✓ Removed: ${fileName}`);
        } catch (e) {
          console.warn(`  ✕ Could not remove ${fileName}:`, e.message);
        }
      }
    } else {
      console.log("[Player Audio] No orphaned files to clean.");
    }
  }

  if (command === "sync" || command === "generate") {
    const toGenerate = force ? analysis.plannedItems : analysis.missing;

    if (toGenerate.length === 0) {
      console.log("\n[Player Audio] All student turn announcements are up to date! (0 needed)");
    } else {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        console.error("\nError: Missing ELEVENLABS_API_KEY environment variable.");
        process.exit(1);
      }

      console.log(`\n[Player Audio] Generating ${toGenerate.length} audio file(s) via ElevenLabs (${ELEVENLABS_MODEL_ID})...`);

      let completed = 0;
      for (const item of toGenerate) {
        completed++;
        process.stdout.write(
          `[${completed}/${toGenerate.length}] Synthesizing "${item.text}" (${item.voice.name} - ${item.voice.gender}) -> ${item.fileName}... `
        );
        const bytes = await synthesizeToFile(item, apiKey);
        console.log(`(${Math.round(bytes / 1024)} KB)`);

        // Small pause between calls
        await new Promise((r) => setTimeout(r, 200));
      }

      console.log(`\n✅ Successfully generated ${toGenerate.length} audio files!`);
    }

    // Write updated manifest.json
    writeManifest(analysis.studentManifest);
    console.log(`[Player Audio] Manifest updated at ${MANIFEST_PATH}`);
  }
}

main().catch((err) => {
  console.error("\n[Player Audio] Error:", err.message);
  process.exit(1);
});
