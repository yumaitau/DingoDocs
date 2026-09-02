import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TIME_ZONE = "Australia/Sydney";

const supportedTimeZones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
const supportedTimeZoneSet = new Set(supportedTimeZones);

/** Returns every selectable IANA time zone supported by this runtime. */
export function listSupportedTimeZones() {
  return supportedTimeZones;
}

/** Rejects aliases and offsets so stored preferences remain portable IANA IDs. */
export function isSupportedTimeZone(value: string) {
  return supportedTimeZoneSet.has(value);
}

/** Formats an instant in the user's stored time zone with an explicit zone label. */
export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone: string,
) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

/** Converts a stored instant to an HTML datetime-local value in the user's zone. */
export function formatDateTimeInput(value: Date | string, timeZone: string) {
  return formatInTimeZone(value, timeZone, "yyyy-MM-dd'T'HH:mm");
}

/** Converts an HTML datetime-local wall time in the user's zone to a UTC instant. */
export function parseDateTimeInTimeZone(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Date and time must use YYYY-MM-DDTHH:mm");
  }
  if (!isSupportedTimeZone(timeZone)) throw new Error("Unsupported time zone");

  const instant = fromZonedTime(value, timeZone);
  if (
    Number.isNaN(instant.getTime()) ||
    formatDateTimeInput(instant, timeZone) !== value
  ) {
    throw new Error("That local time does not exist in the selected time zone");
  }
  return instant;
}
