export const locales = ["en", "de", "fr", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_STORAGE_KEY = "dingodocs.locale";

type Dictionary = {
  nav: {
    dashboard: string;
    analytics: string;
    clients: string;
    engagements: string;
    schedule: string;
    programs: string;
    opportunities: string;
    findingsLibrary: string;
    reports: string;
    tasks: string;
    runbooks: string;
    templates: string;
    importsExports: string;
    preferences: string;
    team: string;
    auditLog: string;
    integrations: string;
    settings: string;
  };
  severity: {
    informational: string;
    low: string;
    medium: string;
    high: string;
    critical: string;
  };
  locale: {
    label: string;
    language: string;
  };
};

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    nav: {
      dashboard: "Dashboard",
      analytics: "Analytics",
      clients: "Clients",
      engagements: "Engagements",
      schedule: "Schedule",
      programs: "Programs",
      opportunities: "Opportunities",
      findingsLibrary: "Findings Library",
      reports: "Reports",
      tasks: "Tasks",
      runbooks: "Runbooks",
      templates: "Templates",
      importsExports: "Imports & Exports",
      preferences: "Preferences",
      team: "Team",
      auditLog: "Audit Log",
      integrations: "Integrations",
      settings: "Settings",
    },
    severity: {
      informational: "Informational",
      low: "Low",
      medium: "Medium",
      high: "High",
      critical: "Critical",
    },
    locale: {
      label: "Language",
      language: "English",
    },
  },
  de: {
    nav: {
      dashboard: "Übersicht",
      analytics: "Analytik",
      clients: "Kunden",
      engagements: "Engagements",
      schedule: "Zeitplan",
      programs: "Programme",
      opportunities: "Chancen",
      findingsLibrary: "Findings-Bibliothek",
      reports: "Berichte",
      tasks: "Aufgaben",
      runbooks: "Runbooks",
      templates: "Vorlagen",
      importsExports: "Import & Export",
      preferences: "Einstellungen",
      team: "Team",
      auditLog: "Audit-Protokoll",
      integrations: "Integrationen",
      settings: "Konfiguration",
    },
    severity: {
      informational: "Informativ",
      low: "Niedrig",
      medium: "Mittel",
      high: "Hoch",
      critical: "Kritisch",
    },
    locale: {
      label: "Sprache",
      language: "Deutsch",
    },
  },
  fr: {
    nav: {
      dashboard: "Tableau de bord",
      analytics: "Analytique",
      clients: "Clients",
      engagements: "Missions",
      schedule: "Planning",
      programs: "Programmes",
      opportunities: "Opportunités",
      findingsLibrary: "Bibliothèque de constats",
      reports: "Rapports",
      tasks: "Tâches",
      runbooks: "Runbooks",
      templates: "Modèles",
      importsExports: "Imports et exports",
      preferences: "Préférences",
      team: "Équipe",
      auditLog: "Journal d'audit",
      integrations: "Intégrations",
      settings: "Paramètres",
    },
    severity: {
      informational: "Informationnel",
      low: "Faible",
      medium: "Moyen",
      high: "Élevé",
      critical: "Critique",
    },
    locale: {
      label: "Langue",
      language: "Français",
    },
  },
  es: {
    nav: {
      dashboard: "Panel",
      analytics: "Analítica",
      clients: "Clientes",
      engagements: "Compromisos",
      schedule: "Calendario",
      programs: "Programas",
      opportunities: "Oportunidades",
      findingsLibrary: "Biblioteca de hallazgos",
      reports: "Informes",
      tasks: "Tareas",
      runbooks: "Runbooks",
      templates: "Plantillas",
      importsExports: "Importaciones y exportaciones",
      preferences: "Preferencias",
      team: "Equipo",
      auditLog: "Registro de auditoría",
      integrations: "Integraciones",
      settings: "Configuración",
    },
    severity: {
      informational: "Informativo",
      low: "Bajo",
      medium: "Medio",
      high: "Alto",
      critical: "Crítico",
    },
    locale: {
      label: "Idioma",
      language: "Español",
    },
  },
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (locales as readonly string[]).includes(value)
  );
}

export function getDictionary(locale: Locale = defaultLocale): Dictionary {
  return dictionaries[isLocale(locale) ? locale : defaultLocale];
}

export function readStoredLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

const LOCALE_CHANGE_EVENT = "dingodocs-locale";

export function subscribeStoredLocale(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LOCALE_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(LOCALE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function writeStoredLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
}
