"use client";

import { useSyncExternalStore } from "react";
import {
  defaultLocale,
  getDictionary,
  isLocale,
  locales,
  readStoredLocale,
  subscribeStoredLocale,
  writeStoredLocale,
  type Locale,
} from "@/lib/i18n";

export function LocaleSwitch({
  value,
  onChange,
  className,
}: {
  value?: Locale;
  onChange?: (locale: Locale) => void;
  className?: string;
}) {
  const stored = useSyncExternalStore(
    subscribeStoredLocale,
    readStoredLocale,
    () => defaultLocale,
  );
  const locale = value ?? stored;
  const dictionary = getDictionary(locale);

  return (
    <label
      className={
        className ?? "flex items-center gap-1.5 text-xs text-slate-500"
      }
    >
      <span className="sr-only">{dictionary.locale.label}</span>
      <select
        aria-label={dictionary.locale.label}
        className="rounded-md border bg-paper px-1.5 py-1 text-xs font-medium text-slate-700"
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          writeStoredLocale(next);
          onChange?.(next);
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {getDictionary(code).locale.language}
          </option>
        ))}
      </select>
    </label>
  );
}
