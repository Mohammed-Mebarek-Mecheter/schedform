// src/index.ts
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "./lib/context";
import { appRouter } from "./routers/index";
import { createAuth } from "./lib/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Use the globally defined CloudflareBindings interface
const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(logger());

app.use(
    "/*",
    cors({
        origin: (origin, c) => {
            const corsOrigin = c.env?.CORS_ORIGIN || process.env.CORS_ORIGIN || "";
            return corsOrigin;
        },
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    }),
);

// Auth routes - create auth instance with bindings and CF properties
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
    // Store bindings in global for env access
    if (c.env) {
        (globalThis as any).env = c.env;
    }

    // Cast to Cloudflare.Env to match the function signature
    const auth = createAuth(c.env as Cloudflare.Env, c.req.raw.cf);
    return auth.handler(c.req.raw);
});

app.use(
    "/trpc/*",
    trpcServer({
        router: appRouter,
        createContext: (_opts, context) => {
            return createContext({ context });
        },
    }),
);

app.get("/", (c) => {
    return c.text("SchedForm Server - OK");
});

// Health check endpoint
app.get("/health", (c) => {
    return c.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        environment: c.env?.NODE_ENV || "development"
    });
});

export default app;
