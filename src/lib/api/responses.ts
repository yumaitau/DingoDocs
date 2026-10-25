import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MfaRequiredError } from "@/lib/auth/mfa-policy";
import { AuthenticationRequiredError } from "@/lib/auth/session";
import { EngagementAccessError } from "@/lib/permissions/access";
import { PermissionDeniedError } from "@/lib/permissions/require";
import { ApiAuthenticationError } from "@/lib/api/authentication";
import { structuredLog } from "@/lib/observability/logger";
import { ExchangeScopeError } from "@/server/services/data-exchange";
import {
  WorkspaceScopeError,
  WorkspaceTransitionError,
} from "@/server/services/engagement-workspace";
import { ReportScopeError } from "@/server/services/reports";

/**
 * API routes are excluded from proxy.ts (it would buffer and truncate large
 * request bodies), so `x-request-id` is only present when the caller sends
 * one. Generate an id so error responses and logs can still be correlated.
 */
export function resolveRequestId(requestId?: string | null) {
  return requestId || crypto.randomUUID();
}

export function apiError(error: unknown, incomingRequestId?: string | null) {
  const requestId = resolveRequestId(incomingRequestId);
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Request validation failed",
          details: error.issues,
        },
        requestId,
      },
      { status: 400 },
    );
  if (error instanceof AuthenticationRequiredError)
    return NextResponse.json(
      {
        error: { code: "authentication_required", message: error.message },
        requestId,
      },
      { status: 401 },
    );
  if (error instanceof ApiAuthenticationError)
    return NextResponse.json(
      {
        error: { code: error.code, message: error.message },
        requestId,
      },
      {
        status: error.status,
        headers:
          error.status === 401
            ? { "www-authenticate": 'Bearer realm="DingoDocs API"' }
            : undefined,
      },
    );
  if (error instanceof MfaRequiredError)
    return NextResponse.json(
      {
        error: { code: error.code, message: error.message },
        requestId,
      },
      { status: 403 },
    );
  if (error instanceof PermissionDeniedError)
    return NextResponse.json(
      {
        error: { code: "permission_denied", message: error.message },
        requestId,
      },
      { status: 403 },
    );
  if (
    error instanceof ExchangeScopeError ||
    error instanceof WorkspaceScopeError ||
    error instanceof ReportScopeError ||
    error instanceof EngagementAccessError
  )
    return NextResponse.json(
      {
        error: { code: "not_found", message: error.message },
        requestId,
      },
      { status: 404 },
    );
  if (error instanceof WorkspaceTransitionError)
    return NextResponse.json(
      {
        error: { code: "conflict", message: error.message },
        requestId,
      },
      { status: 409 },
    );
  structuredLog("error", "api.error", {
    requestId,
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred",
      },
      requestId,
    },
    { status: 500 },
  );
}

export function apiNotFound(requestId?: string | null, message = "Not found") {
  return NextResponse.json(
    {
      error: { code: "not_found", message },
      requestId: resolveRequestId(requestId),
    },
    { status: 404 },
  );
}
