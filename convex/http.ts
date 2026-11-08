import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { isAllowedOrigin } from "./sync";

const http = httpRouter();

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : "https://allenglish.link";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

http.route({
  path: "/api/sync",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("Origin");
    if (origin && !isAllowedOrigin(origin)) {
      return new Response("Forbidden Origin", { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    });
  }),
});

http.route({
  path: "/api/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");
    if (origin && !isAllowedOrigin(origin)) {
      return new Response(
        JSON.stringify({
          status: "error",
          errorMessage: "Access from this domain is not authorized.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const corsHeaders = {
      ...buildCorsHeaders(origin),
      "Content-Type": "application/json",
    };

    try {
      const body = await request.json();
      const fnPath = String(body?.path || "");
      const rawArgs = body?.args && typeof body.args === "object" ? body.args : {};
      const argsWithOrigin = {
        ...rawArgs,
        origin: origin || rawArgs.origin || undefined,
      };

      let value: unknown = null;
      if (fnPath === "sync:checkSyncCode") {
        value = await ctx.runQuery(api.sync.checkSyncCode, argsWithOrigin);
      } else if (fnPath === "sync:getWorkspaceSnapshot") {
        value = await ctx.runQuery(api.sync.getWorkspaceSnapshot, argsWithOrigin);
      } else if (fnPath === "sync:createWorkspace") {
        value = await ctx.runMutation(api.sync.createWorkspace, argsWithOrigin);
      } else if (fnPath === "sync:saveWorkspaceState") {
        value = await ctx.runMutation(api.sync.saveWorkspaceState, argsWithOrigin);
      } else if (fnPath === "sync:saveCurriculumOverrides") {
        value = await ctx.runMutation(api.sync.saveCurriculumOverrides, argsWithOrigin);
      } else {
        return new Response(
          JSON.stringify({ status: "error", errorMessage: "Unknown sync endpoint" }),
          { status: 400, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ status: "success", value }),
        { status: 200, headers: corsHeaders }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Request failed",
        }),
        { status: 400, headers: corsHeaders }
      );
    }
  }),
});

export default http;
