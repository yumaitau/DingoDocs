"use client"; // Error boundaries must be Client Components

import {
  RouteErrorFallback,
  type RouteErrorProps,
} from "@/components/route-error";

export default function PortalError(props: RouteErrorProps) {
  return (
    <RouteErrorFallback
      {...props}
      homeHref="/portal"
      homeLabel="Back to portal"
    />
  );
}
