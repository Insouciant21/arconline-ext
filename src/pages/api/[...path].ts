import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import type { Env } from "../../lib/environment";
import { api } from "../../lib/api";
export const ALL: APIRoute = ({ request, locals }) => api(env as Env, request, locals.cfContext);
