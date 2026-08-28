import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers });

const unavailable = (): Response =>
  reply(503, { error: { code: "account_username_login_unavailable" } });

const requiredEnvironment = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
};

const requiredNamedEnvironment = (pluralName: string, singularName: string): string => {
  const namedKeys = Deno.env.get(pluralName)?.trim();
  if (namedKeys) {
    try {
      const parsed: unknown = JSON.parse(namedKeys);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const defaultKey = (parsed as Record<string, unknown>).default;
        if (typeof defaultKey === "string" && defaultKey.trim()) return defaultKey.trim();
      }
    } catch {
      // Fall back to the legacy singular variable when the JSON map is malformed.
    }
  }
  return requiredEnvironment(singularName);
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { error: { code: "method_not_allowed" } });

  let body: { identifier?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return reply(400, { error: { code: "account_invalid_credentials" } });
  }
  const identifier =
    typeof body.identifier === "string" ? body.identifier.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9][a-z0-9_-]{2,19}$/.test(identifier) || !password || password.length > 128) {
    return reply(401, { error: { code: "account_invalid_credentials" } });
  }

  try {
    const supabaseUrl = requiredEnvironment("SUPABASE_URL");
    const publishableKey = requiredNamedEnvironment(
      "SUPABASE_PUBLISHABLE_KEYS",
      "SUPABASE_PUBLISHABLE_KEY",
    );
    const secretKey = requiredNamedEnvironment("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY");
    const authOptions = {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    };
    const admin = createClient(supabaseUrl, secretKey, { auth: authOptions });
    const publicClient = createClient(supabaseUrl, publishableKey, { auth: authOptions });
    const { data: email, error: lookupError } = await admin.rpc("resolve_account_email", {
      input_identifier: identifier,
    });
    if (lookupError) {
      return unavailable();
    }
    if (typeof email !== "string" || !email) {
      return reply(401, { error: { code: "account_invalid_credentials" } });
    }
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      const status =
        error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
      if (typeof status === "number" && Number.isFinite(status) && status >= 500) {
        return unavailable();
      }
      return reply(401, { error: { code: "account_invalid_credentials" } });
    }
    return reply(200, { session: data.session });
  } catch {
    return unavailable();
  }
});
