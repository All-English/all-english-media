#!/usr/bin/env node

/**
 * Manage and synchronize Smart Phonics word audio files via ElevenLabs.
 *
 * Enforces project policies:
 * - Model: eleven_v4_turbo
 * - Speed: 0.85, Stability: 0.65, Similarity Boost: 0.80 (teacher-like, clear pronunciation)
 * - Text: Plain word (no emotion tags)
 * - Korean Pronunciation Dictionary: sKcMTMc7IZdOIqGSuKGL (v: lBWAKvEKQsfx4Ajakhf7)
 * - Approved American voice roster (rotates female and male voices, strictly avoiding duplicate voices per word)
 * - Persistent manifest: audio/words/manifest.json tracks usedVoiceIds per word
 *
 * Usage:
 *   node scripts/manage-word-audio.js check                    # Inspect existing vs missing vs orphaned files
 *   node scripts/manage-word-audio.js sync                     # Download missing audio (default 3 per word) & clean orphans
 *   node scripts/manage-word-audio.js sync --count 4           # Ensure 4 variations per word
 *   node scripts/manage-word-audio.js add-voice --word apple   # Add 1 new unused voice variation to a word
 *   node scripts/manage-word-audio.js clean                    # Remove orphaned audio files only
 *   node scripts/manage-word-audio.js generate --force         # Re-generate all variations
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CURRICULUM_PATH = path.join(ROOT_DIR, "curriculum.json");
const AUDIO_DIR = path.join(ROOT_DIR, "audio", "words");
const MANIFEST_PATH = path.join(AUDIO_DIR, "manifest.json");

// Project Policy Enforcements
const ELEVENLABS_MODEL_ID = "eleven_v4_turbo";
const ELEVENLABS_SPEED = 0.85;
const ELEVENLABS_STABILITY = 0.65;
const ELEVENLABS_SIMILARITY = 0.8;
const ELEVENLABS_PRONUNCIATION_DICT_ID = "sKcMTMc7IZdOIqGSuKGL";
const ELEVENLABS_PRONUNCIATION_VERSION_ID = "lBWAKvEKQsfx4Ajakhf7";

// Approved American Voices
export const FEMALE_VOICES = [
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "FEMALE" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", gender: "FEMALE" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "FEMALE" },
  { id: "Z3R5wn05IrDiVCyEkUrK", name: "Arabella", gender: "FEMALE" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "FEMALE" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "FEMALE" },
];

export const MALE_VOICES = [
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "MALE" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "MALE" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", gender: "MALE" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "MALE" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "MALE" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", gender: "MALE" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", gender: "MALE" },
];

export function toWordSlug(word) {
  return String(word || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
}

export function extractCurriculumWords() {
  if (!fs.existsSync(CURRICULUM_PATH)) {
    throw new Error(`curriculum.json not found at ${CURRICULUM_PATH}`);
  }

  const data = JSON.parse(fs.readFileSync(CURRICULUM_PATH, "utf8"));
  const smartPhonics = data.series?.find((s) => s.id === "smart-phonics");
  if (!smartPhonics) {
    throw new Error("smart-phonics series not found in curriculum.json");
  }

  const wordsMap = new Map();

  for (const level of smartPhonics.levels || []) {
    for (const unit of level.units || []) {
      for (const w of unit.words || []) {
        if (level.bookNumber === 1) {
          // Level 1: picture vocabulary words (e.g. apple, ant, alligator)
          if (w.imageAudio) {
            const vocab = path.basename(w.imageAudio, ".mp3");
            const slug = toWordSlug(vocab);
            if (slug && !wordsMap.has(slug)) {
              wordsMap.set(slug, {
                word: vocab,
                slug,
                officialAudio: w.imageAudio,
                level: level.id,
                unit: unit.id,
              });
            }
          }
        } else {
          // Levels 2-5: unit words
          if (w.word && w.word.length > 1) {
            const slug = toWordSlug(w.word);
            if (slug && !wordsMap.has(slug)) {
              wordsMap.set(slug, {
                word: w.word,
                slug,
                officialAudio: w.audio,
                level: level.id,
                unit: unit.id,
              });
            }
          }
        }
      }
    }
  }

  return Array.from(wordsMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

export function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {
      updatedAt: 0,
      updatedAtISO: "",
      totalWords: 0,
      words: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (e) {
    console.warn(`[Word Audio] Could not parse existing manifest: ${e.message}`);
    return {
      updatedAt: 0,
      updatedAtISO: "",
      totalWords: 0,
      words: {},
    };
  }
}

export function writeManifest(manifestData) {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
  const content = {
    updatedAt: Date.now(),
    updatedAtISO: new Date().toISOString(),
    totalWords: Object.keys(manifestData.words || {}).length,
    words: manifestData.words || {},
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(content, null, 2));
}

/**
 * Pick an unused voice for a word, alternating genders to guarantee both.
 */
export function selectVoiceForWord(wordIndex, existingVariations, targetGenderPreference = null) {
  const usedVoiceIds = new Set(existingVariations.map((v) => v.voice?.id || v.voiceId).filter(Boolean));
  const hasFemale = existingVariations.some((v) => (v.voice?.gender || v.gender) === "FEMALE");
  const hasMale = existingVariations.some((v) => (v.voice?.gender || v.gender) === "MALE");

  let desiredGender = targetGenderPreference;
  if (!desiredGender) {
    if (!hasFemale && hasMale) desiredGender = "FEMALE";
    else if (!hasMale && hasFemale) desiredGender = "MALE";
    else {
      // Alternate starting gender by word index
      const startFemale = wordIndex % 2 === 0;
      desiredGender = (existingVariations.length % 2 === 0)
        ? (startFemale ? "FEMALE" : "MALE")
        : (startFemale ? "MALE" : "FEMALE");
    }
  }

  let candidate = null;
  if (desiredGender === "FEMALE") {
    const fLen = FEMALE_VOICES.length;
    for (let i = 0; i < fLen; i++) {
      const v = FEMALE_VOICES[(wordIndex + existingVariations.length + i) % fLen];
      if (!usedVoiceIds.has(v.id)) {
        candidate = v;
        break;
      }
    }
  } else {
    const mLen = MALE_VOICES.length;
    for (let i = 0; i < mLen; i++) {
      const v = MALE_VOICES[(wordIndex + existingVariations.length + i) % mLen];
      if (!usedVoiceIds.has(v.id)) {
        candidate = v;
        break;
      }
    }
  }

  // Fallback if desired gender is completely exhausted
  if (!candidate) {
    const all = [...FEMALE_VOICES, ...MALE_VOICES];
    for (let i = 0; i < all.length; i++) {
      const v = all[(wordIndex + existingVariations.length + i) % all.length];
      if (!usedVoiceIds.has(v.id)) {
        candidate = v;
        break;
      }
    }
  }

  if (!candidate) {
    throw new Error(`All available voices have already been used for word index ${wordIndex}`);
  }

  return candidate;
}

export async function synthesizeToFile(text, voiceId, targetPath, apiKey) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const payload = {
    text: text,
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: {
      stability: ELEVENLABS_STABILITY,
      similarity_boost: ELEVENLABS_SIMILARITY,
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
      fs.writeFileSync(targetPath, buffer);
      return buffer.length;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`[Retry ${attempt}] ${path.basename(targetPath)}: ${err.message}. Retrying in 1.5s...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// ── CLI Main ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "sync";
  const force = args.includes("--force");

  let targetCount = 3;
  const countIdx = args.indexOf("--count");
  if (countIdx !== -1 && args[countIdx + 1]) {
    targetCount = parseInt(args[countIdx + 1], 10) || 3;
  }

  const wordFilterIdx = args.indexOf("--word");
  const wordFilter = wordFilterIdx !== -1 ? args[wordFilterIdx + 1]?.toLowerCase() : null;

  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  const curriculumWords = extractCurriculumWords();
  const manifestData = readManifest();
  if (!manifestData.words) manifestData.words = {};

  const existingDiskFiles = new Set(
    fs
      .readdirSync(AUDIO_DIR)
      .filter((f) => f.endsWith(".mp3"))
  );

  // Build planned inventory
  const plannedFiles = new Set();
  const missingTasks = [];

  curriculumWords.forEach((item, wIdx) => {
    if (wordFilter && item.slug !== wordFilter && item.word.toLowerCase() !== wordFilter) {
      return;
    }

    let wordEntry = manifestData.words[item.slug];
    if (!wordEntry) {
      wordEntry = {
        word: item.word,
        slug: item.slug,
        officialAudio: item.officialAudio,
        usedVoiceIds: [],
        usedVoiceNames: [],
        variations: [],
      };
      manifestData.words[item.slug] = wordEntry;
    } else {
      wordEntry.officialAudio = item.officialAudio;
    }

    // Filter out invalid/deleted files from variations
    if (!force) {
      wordEntry.variations = wordEntry.variations.filter((v) => existingDiskFiles.has(v.file));
      wordEntry.usedVoiceIds = wordEntry.variations.map((v) => v.voice.id);
      wordEntry.usedVoiceNames = wordEntry.variations.map((v) => v.voice.name);
    } else {
      wordEntry.variations = [];
      wordEntry.usedVoiceIds = [];
      wordEntry.usedVoiceNames = [];
    }

    // Determine how many variations are needed
    const currentCount = wordEntry.variations.length;
    const needed = Math.max(0, targetCount - currentCount);

    for (let i = 0; i < needed; i++) {
      const nextVersion = wordEntry.variations.length + 1;
      const fileName = `${item.slug}_v${nextVersion}.mp3`;
      const filePath = path.join(AUDIO_DIR, fileName);

      // Select voice not yet used for this word
      const voice = selectVoiceForWord(wIdx, wordEntry.variations);

      const task = {
        wordIndex: wIdx,
        word: item.word,
        slug: item.slug,
        version: nextVersion,
        fileName,
        filePath,
        voice,
      };

      // Temporarily mark voice as used so subsequent iterations don't duplicate
      wordEntry.variations.push({
        version: nextVersion,
        file: fileName,
        path: `audio/words/${fileName}`,
        voice,
        generatedAt: "",
      });
      wordEntry.usedVoiceIds.push(voice.id);
      wordEntry.usedVoiceNames.push(voice.name);

      missingTasks.push(task);
    }

    // Record all planned files for orphan analysis
    wordEntry.variations.forEach((v) => plannedFiles.add(v.file));
  });

  const orphanedFiles = Array.from(existingDiskFiles).filter((f) => !plannedFiles.has(f));

  if (command === "check") {
    console.log(`\n── Word Audio Status Check ──────────────────────────────`);
    console.log(`Curriculum words:    ${curriculumWords.length}`);
    console.log(`Target variations:   ${targetCount} per word (${curriculumWords.length * targetCount} total)`);
    console.log(`Existing on disk:    ${existingDiskFiles.size}`);
    console.log(`Missing variations:  ${missingTasks.length}`);
    console.log(`Orphaned files:      ${orphanedFiles.length}`);

    if (missingTasks.length > 0) {
      console.log(`\nFirst 10 missing variations:`);
      missingTasks.slice(0, 10).forEach((t) => {
        console.log(` - ${t.fileName} ("${t.word}" via ${t.voice.name} [${t.voice.gender}])`);
      });
      if (missingTasks.length > 10) {
        console.log(` ... and ${missingTasks.length - 10} more`);
      }
    }

    if (orphanedFiles.length > 0) {
      console.log(`\nOrphaned files to remove (${orphanedFiles.length}):`);
      orphanedFiles.slice(0, 10).forEach((f) => console.log(` - ${f}`));
    }
    return;
  }

  if (command === "clean" || command === "sync") {
    if (orphanedFiles.length > 0) {
      console.log(`\n[Word Audio] Removing ${orphanedFiles.length} orphaned audio file(s)...`);
      for (const fileName of orphanedFiles) {
        const filePath = path.join(AUDIO_DIR, fileName);
        try {
          fs.unlinkSync(filePath);
          console.log(`  ✓ Removed: ${fileName}`);
        } catch (e) {
          console.warn(`  ✕ Could not remove ${fileName}:`, e.message);
        }
      }
    }
  }

  if (command === "sync" || command === "add-voice" || command === "generate") {
    if (missingTasks.length === 0) {
      console.log(`\n[Word Audio] All ${curriculumWords.length} words already have ${targetCount} audio variations! (0 needed)`);
      writeManifest(manifestData);
      console.log(`[Word Audio] Manifest is up to date at ${MANIFEST_PATH}`);
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error("\nError: Missing ELEVENLABS_API_KEY environment variable.");
      process.exit(1);
    }

    console.log(`\n[Word Audio] Generating ${missingTasks.length} audio file(s) via ElevenLabs (${ELEVENLABS_MODEL_ID})...`);

    // Worker pool concurrency of 2 for fast & safe generation without 429 rate limit
    const CONCURRENCY = 2;
    let completed = 0;
    let taskIndex = 0;

    async function worker() {
      while (taskIndex < missingTasks.length) {
        const currentTask = missingTasks[taskIndex++];
        try {
          const bytes = await synthesizeToFile(currentTask.word, currentTask.voice.id, currentTask.filePath, apiKey);
          completed++;
          process.stdout.write(
            `[${completed}/${missingTasks.length}] "${currentTask.word}" (${currentTask.voice.name} - ${currentTask.voice.gender}) -> ${currentTask.fileName} (${Math.round(bytes / 1024)} KB)\n`
          );

          // Update timestamp in manifest variation
          const wEntry = manifestData.words[currentTask.slug];
          if (wEntry) {
            const v = wEntry.variations.find((x) => x.file === currentTask.fileName);
            if (v) v.generatedAt = new Date().toISOString();
          }

          // Save manifest incrementally every 20 tasks
          if (completed % 20 === 0) {
            writeManifest(manifestData);
          }
        } catch (err) {
          console.error(`\n✕ Error synthesizing ${currentTask.fileName}: ${err.message}`);
          throw err;
        }

        // Small pause between worker calls
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    writeManifest(manifestData);
    console.log(`\n✅ Successfully generated all ${missingTasks.length} word audio files!`);
    console.log(`[Word Audio] Manifest saved to ${MANIFEST_PATH}`);
  }
}

main().catch((err) => {
  console.error("\n[Word Audio] Fatal error:", err.message);
  process.exit(1);
});
