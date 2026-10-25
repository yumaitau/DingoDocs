"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Radix overlays set `pointer-events: none` on <body> while open. If the route
 * changes mid-close the restore is skipped and the page stays unclickable, so
 * clear it on every pathname change.
 */
export function RadixPointerEventsReset() {
  const pathname = usePathname();
  useEffect(() => {
    if (document.body.style.pointerEvents === "none")
      document.body.style.pointerEvents = "";
  }, [pathname]);
  return null;
}
