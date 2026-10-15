import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import type { Env } from "../../lib/environment";
import { api } from "../../lib/api";
export const ALL: APIRoute = ({ request }) => api(env as Env, request);
