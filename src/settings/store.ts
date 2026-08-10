import {
  defaultWorkbenchSettings,
  normalizeWorkbenchSettings,
  type WorkbenchSettings,
} from './model';

export const WORKBENCH_SETTINGS_STORAGE_KEY = 'kiwoom-desk.settings.v1';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): SettingsStorage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

export function loadWorkbenchSettings(storage: SettingsStorage | undefined = browserStorage()): WorkbenchSettings {
  if (!storage) return defaultWorkbenchSettings();
  try {
    const raw = storage.getItem(WORKBENCH_SETTINGS_STORAGE_KEY);
    return normalizeWorkbenchSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultWorkbenchSettings();
  }
}

export function saveWorkbenchSettings(
  value: WorkbenchSettings,
  storage: SettingsStorage | undefined = browserStorage(),
): WorkbenchSettings {
  const normalized = normalizeWorkbenchSettings(value);
  storage?.setItem(WORKBENCH_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function resetWorkbenchSettings(storage: SettingsStorage | undefined = browserStorage()): WorkbenchSettings {
  storage?.removeItem(WORKBENCH_SETTINGS_STORAGE_KEY);
  return defaultWorkbenchSettings();
}

export function exportWorkbenchSettings(value: WorkbenchSettings): string {
  return `${JSON.stringify(normalizeWorkbenchSettings(value), null, 2)}\n`;
}

export function importWorkbenchSettings(text: string): WorkbenchSettings {
  return normalizeWorkbenchSettings(JSON.parse(text));
}
