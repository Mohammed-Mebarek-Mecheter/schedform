import type { Context as HonoContext } from "hono";
import { createAuth } from "./auth";
import { getCloudflareBindings } from "./env";

export type CreateContextOptions = {
    context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
    // Get Cloudflare bindings from the environment
    const bindings = getCloudflareBindings();

    // Get CF properties from the request (cast to any to handle type differences)
    const cf = context.req.raw.cf as any;

    // Create auth instance with Cloudflare bindings
    const auth = createAuth(bindings, cf);

    const session = await auth.api.getSession({
        headers: context.req.raw.headers,
    });

    return {
        session,
        bindings,
        cf,
        auth,
    };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
