// lib/env.ts
let env: Record<string, string> = {};

if (typeof process !== "undefined" && process.env) {
    // Running locally in Node
    env = process.env as Record<string, string>;
} else if (typeof globalThis !== "undefined" && (globalThis as any).env) {
    // Running inside Cloudflare Workers runtime
    env = (globalThis as any).env;
}

export { env };
