"use client"; // Error boundaries must be Client Components

import {
  RouteErrorFallback,
  type RouteErrorProps,
} from "@/components/route-error";

export default function AppError(props: RouteErrorProps) {
  return (
    <RouteErrorFallback
      {...props}
      homeHref="/dashboard"
      homeLabel="Go to dashboard"
    />
  );
}
