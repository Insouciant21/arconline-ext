import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import type { Env } from "./lib/environment";
import { authenticated } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname.startsWith("/api/")) return next();
  const signedIn = await authenticated(env as Env, context.request);
  context.locals.authenticated = signedIn;
  if (context.url.pathname === "/login" && signedIn) return context.redirect("/", 302);
  if (context.url.pathname !== "/login" && !signedIn)
    return context.redirect(`/login?callbackUrl=${encodeURIComponent(context.url.pathname + context.url.search)}`, 302);
  const response = await next();
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
});
