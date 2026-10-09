import { NextResponse, type NextRequest } from "next/server";

const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/api/auth",
  "/api/health",
  "/api/ready",
  "/api/openapi",
  "/api/mcp",
  "/api/v1",
];
const publicFile =
  /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|txt|webp|woff2?)$/i;

function isPublic(pathname: string) {
  return publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);
  forwardedHeaders.set("x-pathname", pathname);
  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  response.headers.set("x-request-id", requestId);

  if (
    isPublic(pathname) ||
    pathname.startsWith("/_next") ||
    publicFile.test(pathname)
  )
    return response;

  if (!request.cookies.get("better-auth.session_token")) {
    const destination = new URL("/sign-in", request.url);
    destination.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(destination);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
