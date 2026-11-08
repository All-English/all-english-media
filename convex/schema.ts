import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  workspaces: defineTable({
    syncCode: v.string(),
    pinHash: v.optional(v.string()),
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
  }).index("by_sync_code", ["syncCode"]),

  classes: defineTable({
    syncCode: v.string(),
    name: v.string(),
    players: v.array(v.string()),
    curriculumId: v.string(),
    units: v.array(v.string()),
    schedule: v.object({
      days: v.array(v.string()),
      startTime: v.string(),
      endTime: v.string(),
    }),
    pfClassId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_sync_code", ["syncCode"])
    .index("by_sync_code_and_name", ["syncCode", "name"]),

  curriculumOverrides: defineTable({
    syncCode: v.string(),
    seriesId: v.string(),
    name: v.string(),
    isCustom: v.boolean(),
    description: v.string(),
    levelsJson: v.string(),
    updatedAt: v.number(),
  })
    .index("by_sync_code", ["syncCode"])
    .index("by_sync_code_and_series", ["syncCode", "seriesId"]),
});
