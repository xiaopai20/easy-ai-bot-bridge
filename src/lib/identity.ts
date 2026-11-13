import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { HttpError } from "./http";
import type { Actor } from "./types";

export function actorFromApiEvent(event: APIGatewayProxyEventV2): Actor {
  const requestContext = event.requestContext as APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> }; lambda?: { userId?: string } };
  };
  const authorizer = requestContext.authorizer;
  const claims = authorizer?.jwt?.claims;
  if (claims && typeof claims.sub === "string" && claims.sub.length > 0) {
    const email = typeof claims.email === "string" ? claims.email : "";
    const name =
      (typeof claims.name === "string" && claims.name) ||
      email ||
      "User";
    return { userId: claims.sub, email, name };
  }

  if (process.env.DEV_MODE === "true") {
    return {
      userId: process.env.DEV_USER_ID || "dev-user-123",
      email: process.env.DEV_EMAIL || "dev@example.com",
      name: process.env.DEV_NAME || "Dev User",
    };
  }

  throw new HttpError(401, "Unauthorized");
}
