import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationRequiredError } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/permissions/require";
import { ApiAuthenticationError } from "@/lib/api/authentication";
import { structuredLog } from "@/lib/observability/logger";
import { ExchangeScopeError } from "@/server/services/data-exchange";
import {
  WorkspaceScopeError,
  WorkspaceTransitionError,
} from "@/server/services/engagement-workspace";
import { ReportScopeError } from "@/server/services/reports";

export function apiError(error: unknown, requestId?: string | null) {
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
          error.status === 401 ? { "www-authenticate": 'Bearer realm="DingoDocs API"' } : undefined,
      },
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
    error instanceof ReportScopeError
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
  return NextResponse.json({ error: { code: "not_found", message }, requestId }, { status: 404 });
}
