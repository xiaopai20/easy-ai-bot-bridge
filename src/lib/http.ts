import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function corsHeaders(origin?: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin && origin.length > 0 ? origin : "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-credentials": origin && origin !== "*" ? "true" : "false",
  };
}

export function json(
  statusCode: number,
  body: unknown,
  origin?: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
    body: JSON.stringify(body),
  };
}

export function text(statusCode: number, body: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
  };
}

export function getHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function getBearerToken(
  headers: Record<string, string | undefined> | undefined,
): string | undefined {
  const raw = getHeader(headers, "authorization");
  if (!raw) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return match?.[1];
}

export function rawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

export function parseJsonBody(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
}

export function handleError(err: unknown, origin?: string): APIGatewayProxyStructuredResultV2 {
  if (err instanceof HttpError) {
    return json(err.statusCode, { error: err.message }, origin);
  }
  console.error("unhandled_error", err instanceof Error ? err.message : err);
  return json(500, { error: "Internal server error" }, origin);
}

export function queryParam(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const value = event.queryStringParameters?.[name];
  return value && value.length > 0 ? value : undefined;
}

export function pathParts(event: APIGatewayProxyEventV2): string[] {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";
  return path.split("/").filter(Boolean);
}
