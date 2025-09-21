// db/index.ts
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;
neonConfig.poolQueryViaFetch = true;

// Default connection for CLI and non-Cloudflare environments
const sql = neon(env.DATABASE_URL || "");
export const db = drizzle(sql, { schema });

// Function to create DB instance with Cloudflare bindings
export function createDb(connectionString?: string) {
    const dbUrl = connectionString || env.DATABASE_URL || "";
    if (!dbUrl) {
        throw new Error("No database connection string provided");
    }

    const sql = neon(dbUrl);
    return drizzle(sql, { schema });
}

// For Cloudflare Workers with Hyperdrive
export function createDbWithHyperdrive(hyperdrive: { connectionString: string }) {
    return createDb(hyperdrive.connectionString);
}
