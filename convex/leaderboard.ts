import { query, mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { authorizeWorkspace } from "./sync";

const ALLOWED_GAMES = v.literal("sunken-treasure");
const MAX_PLAYERS_PER_GAME = 500;
const MAX_TOTAL_ROWS_PER_GAME = 700;
const MAX_STATS_JSON = 20_000;
const MAX_BATCH = 200;
const MAX_PLAYER_NAME_LENGTH = 60;

const playerRowValidator = v.object({
  playerName: v.string(),
  statsJson: v.string(),
  updatedAt: v.number(),
  deletedAt: v.optional(v.number()),
});

const upsertItemValidator = v.object({
  playerName: v.string(),
  statsJson: v.string(),
  updatedAt: v.number(),
});

const deleteItemValidator = v.object({
  playerName: v.string(),
  deletedAt: v.number(),
});

function clampTimestamp(ts: number, now: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return now;
  return Math.min(ts, now + 60_000);
}

function parseStatsSummary(statsJson: string): {
  valid: boolean;
  totalPointsAllTime: number;
  totalGamesPlayed: number;
} {
  try {
    const parsed = JSON.parse(statsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, totalPointsAllTime: 0, totalGamesPlayed: 0 };
    }
    const pts = Number(parsed.totalPointsAllTime);
    const games = Number(parsed.totalGamesPlayed);
    return {
      valid: true,
      totalPointsAllTime: Number.isFinite(pts) ? pts : 0,
      totalGamesPlayed: Number.isFinite(games) ? games : 0,
    };
  } catch {
    return { valid: false, totalPointsAllTime: 0, totalGamesPlayed: 0 };
  }
}

export const getGameStats = query({
  args: {
    syncCode: v.string(),
    pin: v.optional(v.string()),
    origin: v.optional(v.string()),
    game: ALLOWED_GAMES,
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      players: v.array(playerRowValidator),
    }),
    v.object({
      ok: v.literal(false),
      errorCode: v.string(),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const auth = await authorizeWorkspace(ctx, args);
    if (!auth.ok) {
      return {
        ok: false as const,
        errorCode: auth.errorCode,
        message: auth.message,
      };
    }

    const rows = await ctx.db
      .query("gameStats")
      .withIndex("by_sync_code_and_game", (q) =>
        q.eq("syncCode", auth.normalizedCode).eq("game", args.game)
      )
      .take(MAX_TOTAL_ROWS_PER_GAME);

    return {
      ok: true as const,
      players: rows.map((r) => ({
        playerName: r.playerName,
        statsJson: r.statsJson,
        updatedAt: r.updatedAt,
        deletedAt: r.deletedAt,
      })),
    };
  },
});

export const saveGameStats = mutation({
  args: {
    syncCode: v.string(),
    pin: v.optional(v.string()),
    origin: v.optional(v.string()),
    game: ALLOWED_GAMES,
    upserts: v.array(upsertItemValidator),
    deletes: v.array(deleteItemValidator),
  },
  returns: v.object({
    ok: v.boolean(),
    errorCode: v.optional(v.string()),
    message: v.optional(v.string()),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const auth = await authorizeWorkspace(ctx, args);
    if (!auth.ok) {
      return {
        ok: false,
        errorCode: auth.errorCode,
        message: auth.message,
        updatedAt: 0,
      };
    }

    if (args.upserts.length > MAX_BATCH || args.deletes.length > MAX_BATCH) {
      return {
        ok: false,
        errorCode: "BATCH_TOO_LARGE",
        message: `Batch exceeds limit of ${MAX_BATCH} items.`,
        updatedAt: 0,
      };
    }

    const parsedUpserts: Array<{
      playerName: string;
      statsJson: string;
      totalPointsAllTime: number;
      totalGamesPlayed: number;
      updatedAt: number;
    }> = [];

    const now = Date.now();
    for (const item of args.upserts) {
      const cleanName = item.playerName.trim();
      if (!cleanName || cleanName.length > MAX_PLAYER_NAME_LENGTH) continue;
      if (item.statsJson.length > MAX_STATS_JSON) {
        return {
          ok: false,
          errorCode: "PAYLOAD_TOO_LARGE",
          message: `Stats JSON for "${cleanName}" exceeds ${MAX_STATS_JSON} bytes.`,
          updatedAt: 0,
        };
      }
      const summary = parseStatsSummary(item.statsJson);
      if (!summary.valid) {
        return {
          ok: false,
          errorCode: "INVALID_PAYLOAD",
          message: `Stats JSON for "${cleanName}" is invalid.`,
          updatedAt: 0,
        };
      }
      parsedUpserts.push({
        playerName: cleanName,
        statsJson: item.statsJson,
        totalPointsAllTime: summary.totalPointsAllTime,
        totalGamesPlayed: summary.totalGamesPlayed,
        updatedAt: clampTimestamp(item.updatedAt, now),
      });
    }

    const normalizedCode = auth.normalizedCode;

    type CapacityState = {
      liveCount: number;
      totalCount: number;
      tombstones: Array<Doc<"gameStats">>;
    };
    const capacityHolder: { state: CapacityState | null } = { state: null };

    async function ensureCapacityLoaded(): Promise<CapacityState> {
      if (capacityHolder.state) return capacityHolder.state;
      const allRows = await ctx.db
        .query("gameStats")
        .withIndex("by_sync_code_and_game", (q) =>
          q.eq("syncCode", normalizedCode).eq("game", args.game)
        )
        .take(MAX_TOTAL_ROWS_PER_GAME);
      const tombstones = allRows
        .filter((r) => r.deletedAt !== undefined)
        .sort((a, b) => (a.deletedAt ?? 0) - (b.deletedAt ?? 0));
      capacityHolder.state = {
        liveCount: allRows.length - tombstones.length,
        totalCount: allRows.length,
        tombstones,
      };
      return capacityHolder.state;
    }

    async function makeRoomIfNeeded(isLiveInsert: boolean): Promise<boolean> {
      const cap = await ensureCapacityLoaded();
      if (isLiveInsert && cap.liveCount >= MAX_PLAYERS_PER_GAME) {
        return false;
      }
      if (cap.totalCount >= MAX_TOTAL_ROWS_PER_GAME) {
        const oldestTombstone = cap.tombstones.shift();
        if (!oldestTombstone) {
          return false;
        }
        await ctx.db.delete(oldestTombstone._id);
        cap.totalCount--;
      }
      return true;
    }

    for (const item of parsedUpserts) {
      const existing = await ctx.db
        .query("gameStats")
        .withIndex("by_sync_code_and_game_and_player", (q) =>
          q
            .eq("syncCode", normalizedCode)
            .eq("game", args.game)
            .eq("playerName", item.playerName)
        )
        .first();

      if (existing) {
        const effectiveTs = Math.max(
          existing.updatedAt,
          existing.deletedAt ?? 0
        );
        if (item.updatedAt < effectiveTs) {
          continue;
        }
        const wasDeleted = existing.deletedAt !== undefined;
        if (wasDeleted) {
          const cap = await ensureCapacityLoaded();
          if (cap.liveCount >= MAX_PLAYERS_PER_GAME) {
            return {
              ok: false,
              errorCode: "PLAYER_LIMIT_REACHED",
              message: `Leaderboard limit of ${MAX_PLAYERS_PER_GAME} players reached for this Sync Code.`,
              updatedAt: 0,
            };
          }
          cap.liveCount++;
          cap.tombstones = cap.tombstones.filter((t) => t._id !== existing._id);
        }
        await ctx.db.patch(existing._id, {
          statsJson: item.statsJson,
          totalPointsAllTime: item.totalPointsAllTime,
          totalGamesPlayed: item.totalGamesPlayed,
          updatedAt: item.updatedAt,
          deletedAt: undefined,
        });
      } else {
        const hasRoom = await makeRoomIfNeeded(true);
        if (!hasRoom) {
          return {
            ok: false,
            errorCode: "PLAYER_LIMIT_REACHED",
            message: `Leaderboard limit of ${MAX_PLAYERS_PER_GAME} players reached for this Sync Code.`,
            updatedAt: 0,
          };
        }
        await ctx.db.insert("gameStats", {
          syncCode: normalizedCode,
          game: args.game,
          playerName: item.playerName,
          statsJson: item.statsJson,
          totalPointsAllTime: item.totalPointsAllTime,
          totalGamesPlayed: item.totalGamesPlayed,
          updatedAt: item.updatedAt,
        });
        if (capacityHolder.state) {
          capacityHolder.state.liveCount++;
          capacityHolder.state.totalCount++;
        }
      }
    }

    for (const del of args.deletes) {
      const cleanName = del.playerName.trim();
      if (!cleanName || cleanName.length > MAX_PLAYER_NAME_LENGTH) continue;
      const incomingDeletedAt = clampTimestamp(del.deletedAt, now);

      const existing = await ctx.db
        .query("gameStats")
        .withIndex("by_sync_code_and_game_and_player", (q) =>
          q
            .eq("syncCode", normalizedCode)
            .eq("game", args.game)
            .eq("playerName", cleanName)
        )
        .first();

      if (existing) {
        const effectiveTs = Math.max(
          existing.updatedAt,
          existing.deletedAt ?? 0
        );
        if (incomingDeletedAt < effectiveTs) {
          continue;
        }
        const wasLive = existing.deletedAt === undefined;
        await ctx.db.patch(existing._id, {
          updatedAt: incomingDeletedAt,
          deletedAt: incomingDeletedAt,
        });
        if (wasLive && capacityHolder.state) {
          capacityHolder.state.liveCount = Math.max(
            0,
            capacityHolder.state.liveCount - 1
          );
          capacityHolder.state.tombstones.push({
            ...existing,
            updatedAt: incomingDeletedAt,
            deletedAt: incomingDeletedAt,
          });
        }
      } else {
        const hasRoom = await makeRoomIfNeeded(false);
        if (!hasRoom) continue;
        const newId = await ctx.db.insert("gameStats", {
          syncCode: normalizedCode,
          game: args.game,
          playerName: cleanName,
          statsJson: "{}",
          totalPointsAllTime: 0,
          totalGamesPlayed: 0,
          updatedAt: incomingDeletedAt,
          deletedAt: incomingDeletedAt,
        });
        if (capacityHolder.state) {
          capacityHolder.state.totalCount++;
          capacityHolder.state.tombstones.push({
            _id: newId,
            _creationTime: now,
            syncCode: normalizedCode,
            game: args.game,
            playerName: cleanName,
            statsJson: "{}",
            totalPointsAllTime: 0,
            totalGamesPlayed: 0,
            updatedAt: incomingDeletedAt,
            deletedAt: incomingDeletedAt,
          });
        }
      }
    }

    return {
      ok: true,
      updatedAt: now,
    };
  },
});
