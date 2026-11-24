// Sync configuration stored in localStorage
// Never included in backups/exports

export interface SyncConfig {
  enabled: boolean;
  url: string;
  key: string;
  lastSeq: number;
  lastSyncedAt: string | null;
}

export const STORAGE_KEY_CONFIG = 'tt_sync_config';
export const STORAGE_KEY_SHADOW = 'tt_sync_shadow';

function getConfigKey(): string {
  return STORAGE_KEY_CONFIG;
}

function getShadowKey(): string {
  return STORAGE_KEY_SHADOW;
}

export function loadConfig(): SyncConfig {
  try {
    const stored = localStorage.getItem(getConfigKey());
    if (stored) {
      const parsed = JSON.parse(stored) as SyncConfig;
      return {
        enabled: parsed.enabled ?? false,
        url: parsed.url ?? '',
        key: parsed.key ?? '',
        lastSeq: parsed.lastSeq ?? 0,
        lastSyncedAt: parsed.lastSyncedAt ?? null,
      };
    }
  } catch {
    // Ignore errors, return defaults
  }
  return {
    enabled: false,
    url: '',
    key: '',
    lastSeq: 0,
    lastSyncedAt: null,
  };
}

export function saveConfig(config: Partial<SyncConfig>): void {
  try {
    const current = loadConfig();
    const updated: SyncConfig = { ...current, ...config };
    localStorage.setItem(getConfigKey(), JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

export function loadShadow(): Record<string, { h: string; u: string }> {
  try {
    const stored = localStorage.getItem(getShadowKey());
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return {};
}

export function saveShadow(shadow: Record<string, { h: string; u: string }>): void {
  try {
    localStorage.setItem(getShadowKey(), JSON.stringify(shadow));
  } catch {
    // Ignore errors
  }
}

export function clearShadow(): void {
  try {
    localStorage.removeItem(getShadowKey());
  } catch {
    // Ignore errors
  }
}
