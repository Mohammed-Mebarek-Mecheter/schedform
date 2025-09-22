// lib/env.ts
import "dotenv/config";

let env: Record<string, string> = {};
let bindings: Cloudflare.Env | null = null;

if (typeof process !== "undefined" && process.env) {
    // Running locally in Node
    env = process.env as Record<string, string>;
} else if (typeof globalThis !== "undefined" && (globalThis as any).env) {
    // Running inside Cloudflare Workers runtime
    bindings = (globalThis as any).env as Cloudflare.Env;
    env = bindings as unknown as Record<string, string>;
}

// Function to get Cloudflare bindings in Workers runtime
export function getCloudflareBindings(): Cloudflare.Env | null {
    return bindings;
}

// Function to check if we're running in Cloudflare Workers
export function isCloudflareWorkers(): boolean {
    return bindings !== null;
}

export { env };
