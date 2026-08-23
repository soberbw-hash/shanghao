import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AccountServerError,
  type AccountBackend,
  type AccountServerErrorCode,
} from "./account-service";

const MAX_JSON_BYTES = 768 * 1024;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const TOKEN_ONLY_DEVELOPMENT_ROUTES = new Set([
  "GET /api/account/me",
  "PUT /api/account/profile",
  "PUT /api/account/avatar",
]);

const enabled = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

interface RateWindow {
  startedAt: number;
  count: number;
}

const ROUTE_LIMITS: Record<string, { windowMs: number; limit: number }> = {
  "POST /api/account/login": { windowMs: 15 * 60_000, limit: 8 },
  "POST /api/account/register": { windowMs: 60 * 60_000, limit: 5 },
  "POST /api/account/refresh": { windowMs: 60_000, limit: 30 },
  "POST /api/account/password-reset": { windowMs: 60 * 60_000, limit: 5 },
  "PUT /api/account/profile": { windowMs: 60_000, limit: 20 },
  "PUT /api/account/avatar": { windowMs: 10 * 60_000, limit: 8 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const requiredText = (value: unknown, maximum: number): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new AccountServerError("account_invalid_request");
  }
  return value;
};

const bearerToken = (request: IncomingMessage): string => {
  const authorization = request.headers.authorization?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new AccountServerError("account_session_expired");
  }
  return requiredText(authorization.slice(7).trim(), 8_192);
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BYTES) throw new AccountServerError("account_invalid_request");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid_json_shape");
    return parsed;
  } catch (error) {
    throw new AccountServerError("account_invalid_request", { cause: error });
  }
};

const statusForError = (code: AccountServerErrorCode): number => {
  switch (code) {
    case "account_not_configured":
      return 503;
    case "account_invalid_credentials":
    case "account_session_expired":
      return 401;
    case "account_username_taken":
    case "account_email_taken":
      return 409;
    case "account_network_error":
    case "account_profile_unavailable":
    case "account_avatar_upload_failed":
      return 502;
    default:
      return 400;
  }
};

export class AccountHttpController {
  private readonly rateWindows = new Map<string, RateWindow>();

  constructor(
    private readonly backend: AccountBackend,
    private readonly logger?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/account/")) return false;

    this.applyHeaders(response);
    if (request.method === "GET" && pathname === "/api/account/status") {
      this.send(response, 200, {
        configured: this.backend.configured,
        guestAllowed: this.guestAllowed,
        secureTransportRequired: !this.insecureDevelopmentConnection,
        insecureDevelopmentConnection: this.insecureDevelopmentConnection,
        auth: this.backend.publicConfiguration,
      });
      return true;
    }

    if (!this.isSecure(request) && !this.isAllowedDevelopmentTokenRequest(request, pathname)) {
      this.send(response, 426, { error: { code: "account_secure_transport_required" } });
      return true;
    }
    if (!this.backend.configured) {
      this.send(response, 503, { error: { code: "account_not_configured" } });
      return true;
    }
    if (!this.consumeRateLimit(request, pathname)) {
      response.setHeader("retry-after", "60");
      this.send(response, 429, { error: { code: "account_rate_limited" } });
      return true;
    }

    try {
      if (request.method === "POST" && pathname === "/api/account/register") {
        const body = await readJsonBody(request);
        const result = await this.backend.register({
          username: requiredText(body.username, 20),
          email: requiredText(body.email, 254),
          password: requiredText(body.password, 128),
          displayName:
            typeof body.displayName === "string" ? requiredText(body.displayName, 32) : undefined,
        });
        if (typeof body.avatarDataUrl === "string" && result.session) {
          result.profile = await this.backend.updateAvatar(
            result.session.accessToken,
            requiredText(body.avatarDataUrl, 720_000),
          );
        }
        this.send(response, 201, result);
        return true;
      }
      if (request.method === "POST" && pathname === "/api/account/login") {
        const body = await readJsonBody(request);
        const result = await this.backend.login(
          requiredText(body.identifier, 254),
          requiredText(body.password, 128),
        );
        this.send(response, 200, result);
        return true;
      }
      if (request.method === "POST" && pathname === "/api/account/refresh") {
        const body = await readJsonBody(request);
        const result = await this.backend.refresh(requiredText(body.refreshToken, 4_096));
        this.send(response, 200, result);
        return true;
      }
      if (request.method === "POST" && pathname === "/api/account/password-reset") {
        const body = await readJsonBody(request);
        await this.backend.requestPasswordReset(requiredText(body.email, 254));
        this.send(response, 202, { ok: true });
        return true;
      }
      if (request.method === "GET" && pathname === "/api/account/me") {
        const profile = await this.backend.getProfile(bearerToken(request));
        this.send(response, 200, { profile });
        return true;
      }
      if (request.method === "PUT" && pathname === "/api/account/profile") {
        const body = await readJsonBody(request);
        const profile = await this.backend.updateProfile(
          bearerToken(request),
          requiredText(body.displayName, 32),
        );
        this.send(response, 200, { profile });
        return true;
      }
      if (request.method === "PUT" && pathname === "/api/account/avatar") {
        const body = await readJsonBody(request);
        const profile = await this.backend.updateAvatar(
          bearerToken(request),
          requiredText(body.dataUrl, 720_000),
        );
        this.send(response, 200, { profile });
        return true;
      }
      this.send(response, 404, { error: { code: "account_route_not_found" } });
      return true;
    } catch (error) {
      const code = error instanceof AccountServerError ? error.code : "account_network_error";
      this.logger?.("account request failed", {
        route: `${request.method ?? "UNKNOWN"} ${pathname}`,
        code,
        remoteAddress: request.socket.remoteAddress,
      });
      this.send(response, statusForError(code), { error: { code } });
      return true;
    }
  }

  get guestAllowed(): boolean {
    const configured = process.env.SHANGHAO_ALLOW_GUESTS?.trim().toLowerCase();
    if (configured === "true" || configured === "1") return true;
    if (configured === "false" || configured === "0") return false;
    // A configured production-like account backend is closed by default. Development servers
    // that need guest testing must opt in explicitly with SHANGHAO_ALLOW_GUESTS=true.
    return !this.backend.configured && process.env.NODE_ENV !== "production";
  }

  get insecureDevelopmentConnection(): boolean {
    return (
      process.env.SHANGHAO_DEPLOYMENT_MODE?.trim().toLowerCase() === "development" &&
      enabled(process.env.ALLOW_INSECURE_DEV_CONNECTION)
    );
  }

  private isSecure(request: IncomingMessage): boolean {
    if (LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? "")) return true;
    if ((request.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted) {
      return true;
    }
    return request.headers["x-forwarded-proto"] === "https";
  }

  private isAllowedDevelopmentTokenRequest(request: IncomingMessage, pathname: string): boolean {
    if (!this.insecureDevelopmentConnection) return false;
    return TOKEN_ONLY_DEVELOPMENT_ROUTES.has(`${request.method ?? "UNKNOWN"} ${pathname}`);
  }

  private consumeRateLimit(request: IncomingMessage, pathname: string): boolean {
    const route = `${request.method ?? "UNKNOWN"} ${pathname}`;
    const limit = ROUTE_LIMITS[route];
    if (!limit) return true;
    const address = request.socket.remoteAddress ?? "unknown";
    const key = `${address}|${route}`;
    const now = Date.now();
    const current = this.rateWindows.get(key);
    if (!current || now - current.startedAt >= limit.windowMs) {
      this.rateWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit.limit;
  }

  private applyHeaders(response: ServerResponse): void {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status);
    response.end(JSON.stringify(body));
  }
}
