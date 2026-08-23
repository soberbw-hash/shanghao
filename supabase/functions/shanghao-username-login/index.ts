import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers });

const requiredEnvironment = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
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
    const publishableKey = requiredEnvironment("SUPABASE_PUBLISHABLE_KEY");
    const secretKey = requiredEnvironment("SUPABASE_SECRET_KEY");
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
    if (lookupError || typeof email !== "string" || !email) {
      return reply(401, { error: { code: "account_invalid_credentials" } });
    }
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return reply(401, { error: { code: "account_invalid_credentials" } });
    }
    return reply(200, { session: data.session });
  } catch {
    return reply(503, { error: { code: "account_network_error" } });
  }
});
