import { NextResponse, type NextRequest } from "next/server";

const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/invite",
  "/api/auth",
  "/api/health",
  "/api/ready",
];

function isPublic(pathname: string) {
  return publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();
  response.headers.set(
    "x-request-id",
    request.headers.get("x-request-id") ?? crypto.randomUUID(),
  );

  if (
    isPublic(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  )
    return response;

  if (!request.cookies.get("better-auth.session_token")) {
    const destination = new URL("/sign-in", request.url);
    destination.searchParams.set("next", pathname);
    return NextResponse.redirect(destination);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
