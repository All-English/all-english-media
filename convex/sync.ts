import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const MAX_CLASSES_PER_WORKSPACE = 60;
const MAX_PLAYERS_PER_CLASS = 60;
const MAX_UNITS_PER_CLASS = 200;
const MAX_CURRICULUM_OVERRIDES = 30;
const MAX_LEVELS_JSON_LENGTH = 600_000;

export function isAllowedOrigin(origin?: string | null): boolean {
  if (!origin) return true;
  const trimmed = origin.trim().toLowerCase();
  if (trimmed === "null" || trimmed.startsWith("file://")) return true;

  let hostname = "";
  try {
    const parsed = new URL(trimmed);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    hostname = trimmed.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  }

  if (!hostname) return false;

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    return true;
  }

  if (hostname === "allenglish.link" || hostname.endsWith(".allenglish.link")) {
    return true;
  }

  if (hostname.endsWith(".netlify.app")) {
    const sub = hostname.replace(/\.netlify\.app$/, "");
    return (
      sub === "all-english-media" ||
      sub === "allenglish" ||
      sub.startsWith("all-english-") ||
      sub.startsWith("allenglish-")
    );
  }

  if (hostname === "all-english.github.io") {
    return true;
  }

  return false;
}

const scheduleValidator = v.object({
  days: v.array(v.string()),
  startTime: v.string(),
  endTime: v.string(),
});

const classItemValidator = v.object({
  name: v.string(),
  players: v.array(v.string()),
  curriculumId: v.string(),
  units: v.array(v.string()),
  schedule: scheduleValidator,
  pfClassId: v.optional(v.string()),
  updatedAt: v.number(),
});

const curriculumOverrideItemValidator = v.object({
  seriesId: v.string(),
  name: v.string(),
  isCustom: v.boolean(),
  description: v.string(),
  levelsJson: v.string(),
  updatedAt: v.number(),
});

const workspaceSnapshotValidator = v.object({
  syncCode: v.string(),
  hasPin: v.boolean(),
  activeClassName: v.string(),
  activePlayers: v.array(v.string()),
  activePlayersUpdatedAt: v.number(),
  activeCurriculumId: v.string(),
  activeUnits: v.array(v.string()),
  activeUnitsClassName: v.string(),
  activeUnitsUpdatedAt: v.number(),
  hiddenBooks: v.array(v.string()),
  hideBuiltIn: v.boolean(),
  updatedAt: v.number(),
  classes: v.array(classItemValidator),
  curriculumOverrides: v.array(curriculumOverrideItemValidator),
});

const snapshotResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    snapshot: workspaceSnapshotValidator,
  }),
  v.object({
    ok: v.literal(false),
    errorCode: v.union(
      v.literal("INVALID_CODE"),
      v.literal("INVALID_PIN"),
      v.literal("ALREADY_TAKEN"),
      v.literal("NOT_FOUND"),
      v.literal("LOCKED"),
      v.literal("FORBIDDEN_ORIGIN")
    ),
    message: v.string(),
  })
);

function normalizeSyncCode(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function isValidSyncCode(code: string): boolean {
  if (code.length < 2 || code.length > 48) return false;
  return /^[a-z0-9 _.-]+$/.test(code);
}

function normalizePin(pin?: string | null): string {
  return (pin ?? "").trim();
}

function isValidPinFormat(pin: string): boolean {
  if (pin === "") return true;
  return /^\d{4}$/.test(pin);
}

async function computePinHash(syncCode: string, pin: string): Promise<string> {
  const input = `${syncCode}:${pin}`;
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizePlayers(players: string[]): string[] {
  return players
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 60)
    .slice(0, MAX_PLAYERS_PER_CLASS);
}

function sanitizeUnits(units: string[]): string[] {
  return Array.from(
    new Set(
      units
        .map((u) => u.trim())
        .filter((u) => u.length > 0 && u.length <= 80)
    )
  ).slice(0, MAX_UNITS_PER_CLASS);
}

export const checkSyncCode = query({
  args: {
    syncCode: v.string(),
    origin: v.optional(v.string()),
  },
  returns: v.object({
    exists: v.boolean(),
    hasPin: v.boolean(),
    normalizedCode: v.string(),
  }),
  handler: async (ctx, args) => {
    const normalizedCode = normalizeSyncCode(args.syncCode);
    if (!isAllowedOrigin(args.origin) || !isValidSyncCode(normalizedCode)) {
      return { exists: false, hasPin: false, normalizedCode };
    }
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .unique();
    return {
      exists: ws !== null,
      hasPin: ws ? ws.hasPin : false,
      normalizedCode,
    };
  },
});

export const getWorkspaceSnapshot = query({
  args: {
    syncCode: v.string(),
    pin: v.optional(v.string()),
    origin: v.optional(v.string()),
  },
  returns: snapshotResultValidator,
  handler: async (ctx, args) => {
    if (!isAllowedOrigin(args.origin)) {
      return {
        ok: false as const,
        errorCode: "FORBIDDEN_ORIGIN" as const,
        message: "Access from this domain is not authorized.",
      };
    }

    const normalizedCode = normalizeSyncCode(args.syncCode);
    if (!isValidSyncCode(normalizedCode)) {
      return {
        ok: false as const,
        errorCode: "INVALID_CODE" as const,
        message:
          "Sync Code must be 2–48 characters (letters, numbers, spaces, hyphens, or underscores).",
      };
    }

    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .unique();

    if (!ws) {
      return {
        ok: false as const,
        errorCode: "NOT_FOUND" as const,
        message: "Sync Code not found.",
      };
    }

    if (ws.hasPin && ws.pinHash) {
      const cleanPin = normalizePin(args.pin);
      if (!cleanPin) {
        return {
          ok: false as const,
          errorCode: "INVALID_PIN" as const,
          message: "This Sync Code is protected by a 4-digit PIN.",
        };
      }
      const suppliedHash = await computePinHash(normalizedCode, cleanPin);
      if (suppliedHash !== ws.pinHash) {
        return {
          ok: false as const,
          errorCode: "INVALID_PIN" as const,
          message: "Incorrect 4-digit PIN for this Sync Code.",
        };
      }
    }

    const classRows = await ctx.db
      .query("classes")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .take(MAX_CLASSES_PER_WORKSPACE);

    const overrideRows = await ctx.db
      .query("curriculumOverrides")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .take(MAX_CURRICULUM_OVERRIDES);

    return {
      ok: true as const,
      snapshot: {
        syncCode: ws.syncCode,
        hasPin: ws.hasPin,
        activeClassName: ws.activeClassName,
        activePlayers: ws.activePlayers,
        activePlayersUpdatedAt: ws.activePlayersUpdatedAt,
        activeCurriculumId: ws.activeCurriculumId,
        activeUnits: ws.activeUnits,
        activeUnitsClassName: ws.activeUnitsClassName,
        activeUnitsUpdatedAt: ws.activeUnitsUpdatedAt,
        hiddenBooks: ws.hiddenBooks,
        hideBuiltIn: ws.hideBuiltIn,
        updatedAt: ws.updatedAt,
        classes: classRows.map((c) => ({
          name: c.name,
          players: c.players,
          curriculumId: c.curriculumId,
          units: c.units,
          schedule: c.schedule,
          pfClassId: c.pfClassId,
          updatedAt: c.updatedAt,
        })),
        curriculumOverrides: overrideRows.map((o) => ({
          seriesId: o.seriesId,
          name: o.name,
          isCustom: o.isCustom,
          description: o.description,
          levelsJson: o.levelsJson,
          updatedAt: o.updatedAt,
        })),
      },
    };
  },
});

export const createWorkspace = mutation({
  args: {
    syncCode: v.string(),
    pin: v.optional(v.string()),
    origin: v.optional(v.string()),
    initialState: v.optional(
      v.object({
        activeClassName: v.optional(v.string()),
        activePlayers: v.optional(v.array(v.string())),
        activePlayersUpdatedAt: v.optional(v.number()),
        activeCurriculumId: v.optional(v.string()),
        activeUnits: v.optional(v.array(v.string())),
        activeUnitsClassName: v.optional(v.string()),
        activeUnitsUpdatedAt: v.optional(v.number()),
        hiddenBooks: v.optional(v.array(v.string())),
        hideBuiltIn: v.optional(v.boolean()),
        classes: v.optional(v.array(classItemValidator)),
        curriculumOverrides: v.optional(
          v.array(curriculumOverrideItemValidator)
        ),
      })
    ),
  },
  returns: snapshotResultValidator,
  handler: async (ctx, args) => {
    if (!isAllowedOrigin(args.origin)) {
      return {
        ok: false as const,
        errorCode: "FORBIDDEN_ORIGIN" as const,
        message: "Access from this domain is not authorized.",
      };
    }

    const normalizedCode = normalizeSyncCode(args.syncCode);
    if (!isValidSyncCode(normalizedCode)) {
      return {
        ok: false as const,
        errorCode: "INVALID_CODE" as const,
        message:
          "Sync Code must be 2–48 characters (letters, numbers, spaces, hyphens, or underscores).",
      };
    }

    const cleanPin = normalizePin(args.pin);
    if (!isValidPinFormat(cleanPin)) {
      return {
        ok: false as const,
        errorCode: "INVALID_PIN" as const,
        message: "PIN must be exactly 4 digits (or left blank for no PIN).",
      };
    }

    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .unique();

    if (existing) {
      return {
        ok: false as const,
        errorCode: "ALREADY_TAKEN" as const,
        message: `The Sync Code "${normalizedCode}" is already taken! Try adding your school or numbers you'll remember (or click 'Connect Existing' if it's yours).`,
      };
    }

    const now = Date.now();
    const hasPin = cleanPin.length === 4;
    const pinHash = hasPin
      ? await computePinHash(normalizedCode, cleanPin)
      : undefined;

    const init = args.initialState;
    const activeClassName = (init?.activeClassName ?? "").trim();
    const activePlayers = sanitizePlayers(init?.activePlayers ?? []);
    const activePlayersUpdatedAt = init?.activePlayersUpdatedAt ?? (activePlayers.length > 0 ? now : 0);
    const activeCurriculumId = (init?.activeCurriculumId ?? "smart-phonics").trim() || "smart-phonics";
    const activeUnits = sanitizeUnits(init?.activeUnits ?? []);
    const activeUnitsClassName = (init?.activeUnitsClassName ?? "").trim();
    const activeUnitsUpdatedAt = init?.activeUnitsUpdatedAt ?? (activeUnits.length > 0 ? now : 0);
    const hiddenBooks = (init?.hiddenBooks ?? []).slice(0, 50);
    const hideBuiltIn = init?.hideBuiltIn ?? false;

    await ctx.db.insert("workspaces", {
      syncCode: normalizedCode,
      pinHash,
      hasPin,
      activeClassName,
      activePlayers,
      activePlayersUpdatedAt,
      activeCurriculumId,
      activeUnits,
      activeUnitsClassName,
      activeUnitsUpdatedAt,
      hiddenBooks,
      hideBuiltIn,
      updatedAt: now,
    });

    const savedClasses: Array<{
      name: string;
      players: string[];
      curriculumId: string;
      units: string[];
      schedule: { days: string[]; startTime: string; endTime: string };
      pfClassId?: string;
      updatedAt: number;
    }> = [];

    const initialClasses = (init?.classes ?? []).slice(
      0,
      MAX_CLASSES_PER_WORKSPACE
    );
    const seenNames = new Set<string>();
    for (const cls of initialClasses) {
      const cleanName = cls.name.trim();
      if (!cleanName || seenNames.has(cleanName)) continue;
      seenNames.add(cls.name.trim());
      const row = {
        syncCode: normalizedCode,
        name: cleanName,
        players: sanitizePlayers(cls.players),
        curriculumId: cls.curriculumId || "smart-phonics",
        units: sanitizeUnits(cls.units),
        schedule: cls.schedule,
        pfClassId: cls.pfClassId,
        updatedAt: cls.updatedAt || now,
      };
      await ctx.db.insert("classes", row);
      savedClasses.push({
        name: row.name,
        players: row.players,
        curriculumId: row.curriculumId,
        units: row.units,
        schedule: row.schedule,
        pfClassId: row.pfClassId,
        updatedAt: row.updatedAt,
      });
    }

    const savedOverrides: Array<{
      seriesId: string;
      name: string;
      isCustom: boolean;
      description: string;
      levelsJson: string;
      updatedAt: number;
    }> = [];

    const initialOverrides = (init?.curriculumOverrides ?? []).slice(
      0,
      MAX_CURRICULUM_OVERRIDES
    );
    const seenSeries = new Set<string>();
    for (const ov of initialOverrides) {
      const cleanSeriesId = ov.seriesId.trim();
      if (
        !cleanSeriesId ||
        seenSeries.has(cleanSeriesId) ||
        ov.levelsJson.length > MAX_LEVELS_JSON_LENGTH
      ) {
        continue;
      }
      seenSeries.add(cleanSeriesId);
      const row = {
        syncCode: normalizedCode,
        seriesId: cleanSeriesId,
        name: ov.name.trim() || cleanSeriesId,
        isCustom: ov.isCustom,
        description: ov.description.slice(0, 500),
        levelsJson: ov.levelsJson,
        updatedAt: ov.updatedAt || now,
      };
      await ctx.db.insert("curriculumOverrides", row);
      savedOverrides.push({
        seriesId: row.seriesId,
        name: row.name,
        isCustom: row.isCustom,
        description: row.description,
        levelsJson: row.levelsJson,
        updatedAt: row.updatedAt,
      });
    }

    return {
      ok: true as const,
      snapshot: {
        syncCode: normalizedCode,
        hasPin,
        activeClassName,
        activePlayers,
        activePlayersUpdatedAt,
        activeCurriculumId,
        activeUnits,
        activeUnitsClassName,
        activeUnitsUpdatedAt,
        hiddenBooks,
        hideBuiltIn,
        updatedAt: now,
        classes: savedClasses,
        curriculumOverrides: savedOverrides,
      },
    };
  },
});

export const adminCreateWorkspace = internalMutation({
  args: {
    syncCode: v.string(),
    pin: v.string(),
    initialState: v.optional(
      v.object({
        activeClassName: v.optional(v.string()),
        activePlayers: v.optional(v.array(v.string())),
        activePlayersUpdatedAt: v.optional(v.number()),
        activeCurriculumId: v.optional(v.string()),
        activeUnits: v.optional(v.array(v.string())),
        activeUnitsClassName: v.optional(v.string()),
        activeUnitsUpdatedAt: v.optional(v.number()),
        hiddenBooks: v.optional(v.array(v.string())),
        hideBuiltIn: v.optional(v.boolean()),
        classes: v.optional(v.array(classItemValidator)),
        curriculumOverrides: v.optional(
          v.array(curriculumOverrideItemValidator)
        ),
      })
    ),
  },
  returns: snapshotResultValidator,
  handler: async (ctx, args) => {
    const normalizedCode = normalizeSyncCode(args.syncCode);
    if (!isValidSyncCode(normalizedCode)) {
      return {
        ok: false as const,
        errorCode: "INVALID_CODE" as const,
        message:
          "Sync Code must be 2–48 characters (letters, numbers, spaces, hyphens, or underscores).",
      };
    }

    const cleanPin = normalizePin(args.pin);
    if (!/^\d{4}$/.test(cleanPin)) {
      return {
        ok: false as const,
        errorCode: "INVALID_PIN" as const,
        message: "PIN must be a 4-digit number.",
      };
    }

    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .unique();

    if (existing) {
      return {
        ok: false as const,
        errorCode: "ALREADY_TAKEN" as const,
        message: `The Sync Code "${normalizedCode}" already exists.`,
      };
    }

    const now = Date.now();
    const hasPin = true;
    const pinHash = await computePinHash(normalizedCode, cleanPin);

    const init = args.initialState;
    const activeClassName = (init?.activeClassName ?? "").trim();
    const activePlayers = sanitizePlayers(init?.activePlayers ?? []);
    const activePlayersUpdatedAt = init?.activePlayersUpdatedAt ?? (activePlayers.length > 0 ? now : 0);
    const activeCurriculumId = (init?.activeCurriculumId ?? "smart-phonics").trim() || "smart-phonics";
    const activeUnits = sanitizeUnits(init?.activeUnits ?? []);
    const activeUnitsClassName = (init?.activeUnitsClassName ?? "").trim();
    const activeUnitsUpdatedAt = init?.activeUnitsUpdatedAt ?? (activeUnits.length > 0 ? now : 0);
    const hiddenBooks = (init?.hiddenBooks ?? []).slice(0, 50);
    const hideBuiltIn = init?.hideBuiltIn ?? false;

    await ctx.db.insert("workspaces", {
      syncCode: normalizedCode,
      pinHash,
      hasPin,
      activeClassName,
      activePlayers,
      activePlayersUpdatedAt,
      activeCurriculumId,
      activeUnits,
      activeUnitsClassName,
      activeUnitsUpdatedAt,
      hiddenBooks,
      hideBuiltIn,
      updatedAt: now,
    });

    const savedClasses: Array<{
      name: string;
      players: string[];
      curriculumId: string;
      units: string[];
      schedule: { days: string[]; startTime: string; endTime: string };
      pfClassId?: string;
      updatedAt: number;
    }> = [];

    const initialClasses = (init?.classes ?? []).slice(
      0,
      MAX_CLASSES_PER_WORKSPACE
    );
    const seenNames = new Set<string>();
    for (const cls of initialClasses) {
      const cleanName = cls.name.trim();
      if (!cleanName || seenNames.has(cleanName)) continue;
      seenNames.add(cls.name.trim());
      const row = {
        syncCode: normalizedCode,
        name: cleanName,
        players: sanitizePlayers(cls.players),
        curriculumId: cls.curriculumId || "smart-phonics",
        units: sanitizeUnits(cls.units),
        schedule: cls.schedule,
        pfClassId: cls.pfClassId,
        updatedAt: cls.updatedAt || now,
      };
      await ctx.db.insert("classes", row);
      savedClasses.push({
        name: row.name,
        players: row.players,
        curriculumId: row.curriculumId,
        units: row.units,
        schedule: row.schedule,
        pfClassId: row.pfClassId,
        updatedAt: row.updatedAt,
      });
    }

    const savedOverrides: Array<{
      seriesId: string;
      name: string;
      isCustom: boolean;
      description: string;
      levelsJson: string;
      updatedAt: number;
    }> = [];

    const initialOverrides = (init?.curriculumOverrides ?? []).slice(
      0,
      MAX_CURRICULUM_OVERRIDES
    );
    const seenSeries = new Set<string>();
    for (const ov of initialOverrides) {
      const cleanSeriesId = ov.seriesId.trim();
      if (
        !cleanSeriesId ||
        seenSeries.has(cleanSeriesId) ||
        ov.levelsJson.length > MAX_LEVELS_JSON_LENGTH
      ) {
        continue;
      }
      seenSeries.add(cleanSeriesId);
      const row = {
        syncCode: normalizedCode,
        seriesId: cleanSeriesId,
        name: ov.name.trim() || cleanSeriesId,
        isCustom: ov.isCustom,
        description: ov.description.slice(0, 500),
        levelsJson: ov.levelsJson,
        updatedAt: ov.updatedAt || now,
      };
      await ctx.db.insert("curriculumOverrides", row);
      savedOverrides.push({
        seriesId: row.seriesId,
        name: row.name,
        isCustom: row.isCustom,
        description: row.description,
        levelsJson: row.levelsJson,
        updatedAt: row.updatedAt,
      });
    }

    return {
      ok: true as const,
      snapshot: {
        syncCode: normalizedCode,
        hasPin,
        activeClassName,
        activePlayers,
        activePlayersUpdatedAt,
        activeCurriculumId,
        activeUnits,
        activeUnitsClassName,
        activeUnitsUpdatedAt,
        hiddenBooks,
        hideBuiltIn,
        updatedAt: now,
        classes: savedClasses,
        curriculumOverrides: savedOverrides,
      },
    };
  },
});

export const saveWorkspaceState = mutation({
  args: {
    syncCode: v.string(),
    pin: v.optional(v.string()),
    origin: v.optional(v.string()),
    activeClassName: v.optional(v.string()),
    activePlayers: v.optional(v.array(v.string())),
    activePlayersUpdatedAt: v.optional(v.number()),
    activeCurriculumId: v.optional(v.string()),
    activeUnits: v.optional(v.array(v.string())),
    activeUnitsClassName: v.optional(v.string()),
    activeUnitsUpdatedAt: v.optional(v.number()),
    hiddenBooks: v.optional(v.array(v.string())),
    hideBuiltIn: v.optional(v.boolean()),
    upsertClasses: v.optional(v.array(classItemValidator)),
    replaceAllClasses: v.optional(v.boolean()),
    deleteClassNames: v.optional(v.array(v.string())),
  },
  returns: v.object({
    ok: v.boolean(),
    errorCode: v.optional(v.string()),
    message: v.optional(v.string()),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!isAllowedOrigin(args.origin)) {
      return {
        ok: false,
        errorCode: "FORBIDDEN_ORIGIN",
        message: "Access from this domain is not authorized.",
        updatedAt: 0,
      };
    }

    const normalizedCode = normalizeSyncCode(args.syncCode);
    if (!isValidSyncCode(normalizedCode)) {
      return {
        ok: false,
        errorCode: "INVALID_CODE",
        message: "Invalid Sync Code.",
        updatedAt: 0,
      };
    }

    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .unique();

    if (!ws) {
      return {
        ok: false,
        errorCode: "NOT_FOUND",
        message: "Sync Code not found.",
        updatedAt: 0,
      };
    }

    if (ws.hasPin && ws.pinHash) {
      const cleanPin = normalizePin(args.pin);
      if (!cleanPin) {
        return {
          ok: false,
          errorCode: "INVALID_PIN",
          message: "This Sync Code is protected by a 4-digit PIN.",
          updatedAt: 0,
        };
      }
      const suppliedHash = await computePinHash(normalizedCode, cleanPin);
      if (suppliedHash !== ws.pinHash) {
        return {
          ok: false,
          errorCode: "INVALID_PIN",
          message: "Incorrect PIN for this Sync Code.",
          updatedAt: 0,
        };
      }
    }

    const now = Date.now();
    const patch: Partial<{
      activeClassName: string;
      activePlayers: string[];
      activePlayersUpdatedAt: number;
      activeCurriculumId: string;
      activeUnits: string[];
      activeUnitsClassName: string;
      activeUnitsUpdatedAt: number;
      hiddenBooks: string[];
      hideBuiltIn: boolean;
      updatedAt: number;
    }> = {
      updatedAt: now,
    };

    if (args.activeClassName !== undefined) {
      patch.activeClassName = args.activeClassName.trim();
    }
    if (args.activePlayers !== undefined) {
      patch.activePlayers = sanitizePlayers(args.activePlayers);
      patch.activePlayersUpdatedAt = args.activePlayersUpdatedAt ?? now;
    }
    if (args.activeCurriculumId !== undefined) {
      patch.activeCurriculumId =
        args.activeCurriculumId.trim() || "smart-phonics";
    }
    if (args.activeUnits !== undefined) {
      patch.activeUnits = sanitizeUnits(args.activeUnits);
      patch.activeUnitsUpdatedAt = args.activeUnitsUpdatedAt ?? now;
    }
    if (args.activeUnitsClassName !== undefined) {
      patch.activeUnitsClassName = args.activeUnitsClassName.trim();
    }
    if (args.hiddenBooks !== undefined) {
      patch.hiddenBooks = args.hiddenBooks.slice(0, 50);
    }
    if (args.hideBuiltIn !== undefined) {
      patch.hideBuiltIn = args.hideBuiltIn;
    }

    await ctx.db.patch(ws._id, patch);

    if (args.deleteClassNames && args.deleteClassNames.length > 0) {
      for (const delName of args.deleteClassNames) {
        const cleanDel = delName.trim();
        if (!cleanDel) continue;
        const existingCls = await ctx.db
          .query("classes")
          .withIndex("by_sync_code_and_name", (q) =>
            q.eq("syncCode", normalizedCode).eq("name", cleanDel)
          )
          .take(10);
        for (const doc of existingCls) {
          await ctx.db.delete(doc._id);
        }
      }
    }

    if (args.upsertClasses) {
      const existingAll = await ctx.db
        .query("classes")
        .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
        .take(MAX_CLASSES_PER_WORKSPACE + 20);

      const byName = new Map(existingAll.map((c) => [c.name, c]));
      const incoming = args.upsertClasses.slice(0, MAX_CLASSES_PER_WORKSPACE);
      const incomingNames = new Set<string>();

      for (const cls of incoming) {
        const cleanName = cls.name.trim();
        if (!cleanName) continue;
        incomingNames.add(cleanName);
        const existingDoc = byName.get(cleanName);

        const nextPlayers = sanitizePlayers(cls.players);
        const nextUnits = sanitizeUnits(cls.units);

        if (existingDoc) {
          const isStale =
            !args.replaceAllClasses &&
            Boolean(existingDoc.updatedAt && cls.updatedAt && cls.updatedAt < existingDoc.updatedAt);

          if (!isStale) {
            const patched = {
              players:
                nextPlayers.length > 0 || args.replaceAllClasses
                  ? nextPlayers
                  : existingDoc.players,
              curriculumId: cls.curriculumId || existingDoc.curriculumId || "smart-phonics",
              units:
                nextUnits.length > 0 || args.replaceAllClasses
                  ? nextUnits
                  : existingDoc.units,
              schedule: cls.schedule,
              pfClassId: cls.pfClassId ?? existingDoc.pfClassId,
              updatedAt: cls.updatedAt || now,
            };
            await ctx.db.patch(existingDoc._id, patched);
            byName.set(cleanName, { ...existingDoc, ...patched } as any);
          }
        } else if (byName.size < MAX_CLASSES_PER_WORKSPACE) {
          const newDoc = {
            syncCode: normalizedCode,
            name: cleanName,
            players: nextPlayers,
            curriculumId: cls.curriculumId || "smart-phonics",
            units: nextUnits,
            schedule: cls.schedule,
            pfClassId: cls.pfClassId,
            updatedAt: cls.updatedAt || now,
          };
          const newId = await ctx.db.insert("classes", newDoc);
          byName.set(cleanName, { _id: newId, ...newDoc } as any);
        }
      }

      if (args.replaceAllClasses) {
        for (const doc of existingAll) {
          if (!incomingNames.has(doc.name)) {
            await ctx.db.delete(doc._id);
          }
        }
      }
    }

    return {
      ok: true,
      updatedAt: now,
    };
  },
});

export const saveCurriculumOverrides = mutation({
  args: {
    syncCode: v.string(),
    pin: v.optional(v.string()),
    origin: v.optional(v.string()),
    hideBuiltIn: v.optional(v.boolean()),
    activeCurriculumId: v.optional(v.string()),
    overrides: v.array(curriculumOverrideItemValidator),
    replaceAll: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    errorCode: v.optional(v.string()),
    message: v.optional(v.string()),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!isAllowedOrigin(args.origin)) {
      return {
        ok: false,
        errorCode: "FORBIDDEN_ORIGIN",
        message: "Access from this domain is not authorized.",
        updatedAt: 0,
      };
    }

    const normalizedCode = normalizeSyncCode(args.syncCode);
    if (!isValidSyncCode(normalizedCode)) {
      return {
        ok: false,
        errorCode: "INVALID_CODE",
        message: "Invalid Sync Code.",
        updatedAt: 0,
      };
    }

    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .unique();

    if (!ws) {
      return {
        ok: false,
        errorCode: "NOT_FOUND",
        message: "Sync Code not found.",
        updatedAt: 0,
      };
    }

    if (ws.hasPin && ws.pinHash) {
      const cleanPin = normalizePin(args.pin);
      if (!cleanPin) {
        return {
          ok: false,
          errorCode: "INVALID_PIN",
          message: "This Sync Code is protected by a 4-digit PIN.",
          updatedAt: 0,
        };
      }
      const suppliedHash = await computePinHash(normalizedCode, cleanPin);
      if (suppliedHash !== ws.pinHash) {
        return {
          ok: false,
          errorCode: "INVALID_PIN",
          message: "Incorrect PIN for this Sync Code.",
          updatedAt: 0,
        };
      }
    }

    const now = Date.now();
    const wsPatch: Partial<{
      hideBuiltIn: boolean;
      activeCurriculumId: string;
      updatedAt: number;
    }> = { updatedAt: now };

    if (args.hideBuiltIn !== undefined) {
      wsPatch.hideBuiltIn = args.hideBuiltIn;
    }
    if (args.activeCurriculumId !== undefined && args.activeCurriculumId.trim()) {
      wsPatch.activeCurriculumId = args.activeCurriculumId.trim();
    }
    await ctx.db.patch(ws._id, wsPatch);

    const existingRows = await ctx.db
      .query("curriculumOverrides")
      .withIndex("by_sync_code", (q) => q.eq("syncCode", normalizedCode))
      .take(MAX_CURRICULUM_OVERRIDES + 10);

    const bySeries = new Map(existingRows.map((r) => [r.seriesId, r]));
    const incomingSeries = new Set<string>();

    for (const ov of args.overrides.slice(0, MAX_CURRICULUM_OVERRIDES)) {
      const cleanSeriesId = ov.seriesId.trim();
      if (!cleanSeriesId) continue;
      if (ov.levelsJson.length > MAX_LEVELS_JSON_LENGTH) {
        return {
          ok: false,
          errorCode: "PAYLOAD_TOO_LARGE",
          message: `Curriculum override levelsJson for ${cleanSeriesId} exceeds size limit (${MAX_LEVELS_JSON_LENGTH} bytes).`,
          updatedAt: 0,
        };
      }
      incomingSeries.add(cleanSeriesId);
      const existingDoc = bySeries.get(cleanSeriesId);

      if (existingDoc) {
        const isStale =
          !args.replaceAll &&
          Boolean(existingDoc.updatedAt && ov.updatedAt && ov.updatedAt < existingDoc.updatedAt);

        if (!isStale) {
          const patched = {
            name: ov.name.trim() || cleanSeriesId,
            isCustom: ov.isCustom,
            description: ov.description.slice(0, 500),
            levelsJson: ov.levelsJson,
            updatedAt: ov.updatedAt || now,
          };
          await ctx.db.patch(existingDoc._id, patched);
          bySeries.set(cleanSeriesId, { ...existingDoc, ...patched });
        }
      } else {
        const insertDoc = {
          syncCode: normalizedCode,
          seriesId: cleanSeriesId,
          name: ov.name.trim() || cleanSeriesId,
          isCustom: ov.isCustom,
          description: ov.description.slice(0, 500),
          levelsJson: ov.levelsJson,
          updatedAt: ov.updatedAt || now,
        };
        const newId = await ctx.db.insert("curriculumOverrides", insertDoc);
        bySeries.set(cleanSeriesId, { _id: newId, ...insertDoc } as any);
      }
    }

    if (args.replaceAll) {
      for (const doc of existingRows) {
        if (!incomingSeries.has(doc.seriesId)) {
          await ctx.db.delete(doc._id);
        }
      }
    }

    return {
      ok: true,
      updatedAt: now,
    };
  },
});
