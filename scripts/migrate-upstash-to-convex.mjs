#!/usr/bin/env node
/**
 * One-time migration script: Upstash Redis -> Convex.dev
 *
 * Usage:
 *   UPSTASH_URL="https://...upstash.io" UPSTASH_TOKEN="..." CONVEX_URL="https://...convex.cloud" \
 *   node scripts/migrate-upstash-to-convex.mjs "<syncCode>" "[optional4DigitPin]"
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const syncCodeArg = process.argv[2] || process.env.SYNC_CODE || "";
const pinArg = process.argv[3] || process.env.SYNC_PIN || "";

let convexUrl = (process.env.CONVEX_URL || "").trim().replace(/\/$/, "");
if (!convexUrl) {
  for (const envFile of [".env.local", ".env"]) {
    const envPath = path.join(ROOT_DIR, envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const m = content.match(/^CONVEX_URL=(.+)$/m);
      if (m && m[1]) {
        convexUrl = m[1].trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
        break;
      }
    }
  }
}

const upstashUrl = (process.env.UPSTASH_URL || "").trim().replace(/\/$/, "");
const upstashToken = (process.env.UPSTASH_TOKEN || "").trim();

if (!syncCodeArg) {
  console.error(
    "Usage: UPSTASH_URL=... UPSTASH_TOKEN=... CONVEX_URL=... node scripts/migrate-upstash-to-convex.mjs \"<syncCode>\" \"[pin]\""
  );
  process.exit(1);
}

if (!convexUrl) {
  console.error("Error: CONVEX_URL is required (set in .env.local or environment).");
  process.exit(1);
}

async function fetchUpstash(key) {
  if (!upstashUrl || !upstashToken) return null;
  try {
    const res = await fetch(`${upstashUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${upstashToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.result === null || data.result === undefined) return null;
    if (typeof data.result === "string") {
      try {
        const parsed = JSON.parse(data.result);
        if (typeof parsed === "string") {
          try {
            return JSON.parse(parsed);
          } catch {
            return parsed;
          }
        }
        return parsed;
      } catch {
        return data.result;
      }
    }
    return data.result;
  } catch (err) {
    console.warn(`[Migrate] Upstash fetch warning for ${key}:`, err.message);
    return null;
  }
}

async function convexMutation(fnPath, args) {
  const res = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: fnPath, args, format: "json" }),
  });
  const data = await res.json();
  if (!res.ok || data.status === "error") {
    throw new Error(data.errorMessage || `HTTP ${res.status}`);
  }
  return data.value;
}

function computeCurriculumOverrides(cloudCurriculum, masterCurriculum) {
  if (!cloudCurriculum) return [];
  const cloudSeries = Array.isArray(cloudCurriculum.series)
    ? cloudCurriculum.series
    : Array.isArray(cloudCurriculum.curricula)
      ? cloudCurriculum.curricula
      : [];

  const masterSeriesList = Array.isArray(masterCurriculum?.series)
    ? masterCurriculum.series
    : [];
  const masterById = new Map(masterSeriesList.map((s) => [s.id, s]));

  const overrides = [];
  for (const s of cloudSeries) {
    if (!s || !s.id) continue;
    const masterSeries = masterById.get(s.id);
    if (s.isCustom || !masterSeries) {
      overrides.push({
        seriesId: s.id,
        name: s.name || s.id,
        isCustom: true,
        description: s.description || "",
        levelsJson: JSON.stringify(s.levels || []),
        updatedAt: s.updatedAt || Date.now(),
      });
    } else {
      // Compare unit by unit against masterSeries
      const masterUnitMap = new Map();
      for (const lvl of masterSeries.levels || []) {
        const lNum = lvl.level ?? lvl.id;
        for (const u of lvl.units || []) {
          const uNum = u.unit ?? u.unitNumber ?? u.id;
          masterUnitMap.set(`${lNum}:${uNum}`, JSON.stringify(u));
        }
      }

      const diffLevels = [];
      for (const lvl of s.levels || []) {
        const lNum = lvl.level ?? lvl.id;
        const diffUnits = [];
        for (const u of lvl.units || []) {
          const uNum = u.unit ?? u.unitNumber ?? u.id;
          const key = `${lNum}:${uNum}`;
          if (masterUnitMap.get(key) !== JSON.stringify(u)) {
            diffUnits.push(u);
          }
        }
        if (diffUnits.length > 0) {
          diffLevels.push({ ...lvl, units: diffUnits });
        }
      }

      if (diffLevels.length > 0) {
        overrides.push({
          seriesId: s.id,
          name: s.name || masterSeries.name || s.id,
          isCustom: false,
          description: s.description || masterSeries.description || "",
          levelsJson: JSON.stringify(diffLevels),
          updatedAt: s.updatedAt || Date.now(),
        });
      }
    }
  }
  return overrides;
}

async function run() {
  console.log(`Starting migration to Convex (${convexUrl}) for Sync Code: "${syncCodeArg}"...`);

  const [
    cloudSets,
    cloudProfiles,
    cloudPfClasses,
    cloudActiveSession,
    cloudActivePlayers,
    cloudActiveClass,
    cloudActiveUnits,
    cloudHiddenBooks,
    cloudCurriculum,
  ] = await Promise.all([
    fetchUpstash("shared_player_sets"),
    fetchUpstash("shared_class_profiles"),
    fetchUpstash("phonics_flash:classes"),
    fetchUpstash("shared_active_session"),
    fetchUpstash("shared_active_players"),
    fetchUpstash("shared_active_class"),
    fetchUpstash("shared_active_units"),
    fetchUpstash("shared_hidden_books"),
    fetchUpstash("shared_phonics_curriculum"),
  ]);

  const masterPath = path.join(ROOT_DIR, "curriculum.json");
  const masterCurriculum = fs.existsSync(masterPath)
    ? JSON.parse(fs.readFileSync(masterPath, "utf8"))
    : null;

  const classMap = new Map();
  const setsObj = cloudSets && typeof cloudSets === "object" ? cloudSets : {};
  const profObj = cloudProfiles && typeof cloudProfiles === "object" ? cloudProfiles : {};

  for (const [name, players] of Object.entries(setsObj)) {
    if (!name.trim()) continue;
    classMap.set(name.trim(), {
      name: name.trim(),
      players: Array.isArray(players) ? players.map(String) : [],
      curriculumId: "smart-phonics",
      units: [],
      schedule: { days: ["Mon", "Wed", "Fri"], startTime: "15:00", endTime: "16:00" },
      updatedAt: Date.now(),
    });
  }

  for (const [name, prof] of Object.entries(profObj)) {
    if (!name.trim() || !prof || typeof prof !== "object") continue;
    const cleanName = name.trim();
    const existing = classMap.get(cleanName) || {
      name: cleanName,
      players: Array.isArray(setsObj[cleanName]) ? setsObj[cleanName].map(String) : [],
      curriculumId: "smart-phonics",
      units: [],
      schedule: { days: ["Mon", "Wed", "Fri"], startTime: "15:00", endTime: "16:00" },
      updatedAt: Date.now(),
    };
    if (Array.isArray(prof.units)) existing.units = prof.units.map(String);
    if (prof.curriculumId) existing.curriculumId = String(prof.curriculumId);
    if (prof.schedule && Array.isArray(prof.schedule.days)) {
      existing.schedule = {
        days: prof.schedule.days.map(String),
        startTime: String(prof.schedule.startTime || "15:00"),
        endTime: String(prof.schedule.endTime || "16:00"),
      };
    }
    if (typeof prof.updatedAt === "number") existing.updatedAt = prof.updatedAt;
    classMap.set(cleanName, existing);
  }

  if (cloudPfClasses && Array.isArray(cloudPfClasses.classes)) {
    for (const pfCls of cloudPfClasses.classes) {
      if (!pfCls || !pfCls.name) continue;
      const cleanName = pfCls.name.trim();
      const existing = classMap.get(cleanName) || {
        name: cleanName,
        players: [],
        curriculumId: pfCls.curriculumId || "smart-phonics",
        units: [],
        schedule: { days: ["Mon", "Wed", "Fri"], startTime: "15:00", endTime: "16:00" },
        updatedAt: Date.now(),
      };
      if (pfCls.id) existing.pfClassId = String(pfCls.id);
      if (Array.isArray(pfCls.selectedUnits) && pfCls.selectedUnits.length > 0 && existing.units.length === 0) {
        existing.units = pfCls.selectedUnits.map(String);
      }
      if (pfCls.curriculumId) existing.curriculumId = String(pfCls.curriculumId);
      if (pfCls.schedule && Array.isArray(pfCls.schedule.days)) {
        existing.schedule = {
          days: pfCls.schedule.days.map(String),
          startTime: String(pfCls.schedule.startTime || "15:00"),
          endTime: String(pfCls.schedule.endTime || "16:00"),
        };
      }
      classMap.set(cleanName, existing);
    }
  }

  const classes = Array.from(classMap.values());
  const curriculumOverrides = computeCurriculumOverrides(cloudCurriculum, masterCurriculum);

  const activePlayers = Array.isArray(cloudActiveSession?.players)
    ? cloudActiveSession.players.map(String)
    : Array.isArray(cloudActivePlayers)
      ? cloudActivePlayers.map(String)
      : [];
  const activeClassName = String(
    cloudActiveSession?.className || cloudActiveClass || ""
  );
  const activePlayersUpdatedAt = Number(cloudActiveSession?.updatedAt || Date.now());

  const activeUnits = Array.isArray(cloudActiveUnits?.units)
    ? cloudActiveUnits.units.map(String)
    : [];
  const activeCurriculumId = String(
    cloudActiveUnits?.curriculumId ||
      cloudCurriculum?.activeCurriculumId ||
      "smart-phonics"
  );
  const activeUnitsClassName = String(cloudActiveUnits?.className || "");
  const activeUnitsUpdatedAt = Number(cloudActiveUnits?.updatedAt || Date.now());
  const hiddenBooks = Array.isArray(cloudHiddenBooks)
    ? cloudHiddenBooks.map(String)
    : [];
  const hideBuiltIn = Boolean(cloudCurriculum?.hideBuiltIn);

  const createRes = await convexMutation("sync:createWorkspace", {
    syncCode: syncCodeArg,
    pin: pinArg || undefined,
    initialState: {
      activeClassName,
      activePlayers,
      activePlayersUpdatedAt,
      activeCurriculumId,
      activeUnits,
      activeUnitsClassName,
      activeUnitsUpdatedAt,
      hiddenBooks,
      hideBuiltIn,
      classes,
      curriculumOverrides,
    },
  });

  if (createRes.ok) {
    console.log(
      `✅ Workspace "${createRes.snapshot.syncCode}" created with ${createRes.snapshot.classes.length} classes and ${createRes.snapshot.curriculumOverrides.length} curriculum overrides.`
    );
  } else if (createRes.errorCode === "ALREADY_TAKEN") {
    console.log(`Workspace "${syncCodeArg}" already exists; updating its state...`);
    const updateRes = await convexMutation("sync:saveWorkspaceState", {
      syncCode: syncCodeArg,
      pin: pinArg || undefined,
      activeClassName,
      activePlayers,
      activePlayersUpdatedAt,
      activeCurriculumId,
      activeUnits,
      activeUnitsClassName,
      activeUnitsUpdatedAt,
      hiddenBooks,
      hideBuiltIn,
      upsertClasses: classes,
    });
    if (!updateRes.ok) {
      throw new Error(updateRes.message || "Failed to update workspace state");
    }
    if (curriculumOverrides.length > 0) {
      await convexMutation("sync:saveCurriculumOverrides", {
        syncCode: syncCodeArg,
        pin: pinArg || undefined,
        hideBuiltIn,
        activeCurriculumId,
        overrides: curriculumOverrides,
      });
    }
    console.log(
      `✅ Workspace "${syncCodeArg}" updated with ${classes.length} classes and ${curriculumOverrides.length} curriculum overrides.`
    );
  } else {
    throw new Error(`${createRes.errorCode}: ${createRes.message}`);
  }
}

run().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
