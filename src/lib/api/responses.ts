import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationRequiredError } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/permissions/require";

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
  if (error instanceof PermissionDeniedError)
    return NextResponse.json(
      {
        error: { code: "permission_denied", message: error.message },
        requestId,
      },
      { status: 403 },
    );
  console.error(
    JSON.stringify({
      event: "api.error",
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
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
