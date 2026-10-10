import { app, HttpMethod, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z, ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code?: string, details?: unknown) => new HttpError(400, message, code, details);
export const unauthorized = (message = 'Please sign in.') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new HttpError(404, message, 'not_found');
export const conflict = (message: string, code = 'conflict', details?: unknown) => new HttpError(409, message, code, details);

const RAW = Symbol('raw-response');
type RawResponse = HttpResponseInit & { [RAW]: true };

/** Return a fully custom response (status codes, CSV, headers) from a route handler. */
export function raw(init: HttpResponseInit): RawResponse {
  return { ...init, [RAW]: true };
}

export function created(body: unknown): RawResponse {
  return raw({ status: 201, jsonBody: body });
}

export function noContent(): RawResponse {
  return raw({ status: 204 });
}

type Handler = (req: HttpRequest, ctx: InvocationContext) => Promise<unknown>;

interface RouteOptions {
  /** Seconds the browser/CDN may cache a successful GET. Defaults to no-store. */
  cacheSeconds?: number;
}

/**
 * Registers an HTTP function. SWA managed functions must be anonymous at the Functions level —
 * authorization is enforced by staticwebapp.config.json routes AND re-checked in each handler.
 */
export function route(name: string, methods: HttpMethod[], path: string, handler: Handler, options: RouteOptions = {}) {
  app.http(name, {
    methods,
    route: path,
    authLevel: 'anonymous',
    handler: async (req, ctx) => {
      try {
        const result = await handler(req, ctx);
        if (result && typeof result === 'object' && RAW in result) {
          const { [RAW]: _ignored, ...init } = result as RawResponse;
          return withDefaults(init);
        }
        if (result === undefined) return withDefaults({ status: 204 });
        const cache = options.cacheSeconds ? `public, max-age=${options.cacheSeconds}` : 'no-store';
        return withDefaults({ status: 200, jsonBody: result, headers: { 'Cache-Control': cache } });
      } catch (err) {
        return toErrorResponse(err, ctx);
      }
    },
  });
}

function withDefaults(init: HttpResponseInit): HttpResponseInit {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return { ...init, headers: Object.fromEntries(headers.entries()) };
}

function toErrorResponse(err: unknown, ctx: InvocationContext): HttpResponseInit {
  if (err instanceof HttpError) {
    if (err.status >= 500) ctx.error(err);
    return withDefaults({
      status: err.status,
      jsonBody: { error: { message: err.message, code: err.code, details: err.details } },
    });
  }
  if (err instanceof ZodError) {
    return withDefaults({
      status: 400,
      jsonBody: {
        error: {
          message: 'Some details need fixing.',
          code: 'validation',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
    });
  }
  const code = (err as { code?: number }).code;
  if (code === 429) {
    return withDefaults({
      status: 503,
      headers: { 'Retry-After': '2' },
      jsonBody: { error: { message: 'We are a little busy — please try again.', code: 'throttled' } },
    });
  }
  ctx.error('Unhandled error', err);
  return withDefaults({
    status: 500,
    jsonBody: { error: { message: 'Something went wrong on our side.', code: 'server_error' } },
  });
}

export async function readBody<S extends z.ZodType>(req: HttpRequest, schema: S): Promise<z.output<S>> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
  return schema.parse(data);
}

export function query(req: HttpRequest, key: string): string | undefined {
  const value = req.query.get(key);
  return value === null || value === '' ? undefined : value;
}

/** Absolute base URL for links in emails. Prefers APP_BASE_URL, then the forwarded host. */
export function baseUrl(req?: HttpRequest): string {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const host = req?.headers.get('x-forwarded-host') ?? req?.headers.get('host');
  return host ? `https://${host}` : 'http://localhost:4280';
}
