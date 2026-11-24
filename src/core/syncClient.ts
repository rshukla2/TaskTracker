// Sync client - handles communication with the sync server
// Uses sync.ts for diffing, syncConfig.ts for config

import { loadWorkspace, replaceWorkspace } from './db';
import { loadConfig, saveConfig, loadShadow, saveShadow, clearShadow } from './syncConfig';
import { computeOutgoing, applyIncoming, buildShadow, hashItem } from './sync';

// Single-flight flag to prevent concurrent syncs
let isSyncing = false;

// Trim trailing slash from URL
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

// Build auth header
function buildAuthHeader(key: string): string {
  return `Bearer ${key}`;
}

// Call server endpoint
async function callServer(url: string, path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(`${normalizeUrl(url)}${path}`, options);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized: Invalid sync key');
    }
    if (response.status === 404) {
      throw new Error('Server not found: URL may be incorrect');
    }
    if (response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response;
}

// Test connection to server
export async function testConnection(url: string, key: string): Promise<'ok' | '401' | 'unreachable'> {
  try {
    const response = await callServer(url, '/api/sync/pull?since=999999999', {
      headers: { Authorization: buildAuthHeader(key) },
    });

    if (response.status === 401) {
      return '401';
    }

    const data = await response.json();
    return data.seq !== undefined ? 'ok' : 'unreachable';
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unauthorized')) return '401';
    return 'unreachable';
  }
}

// Sync now - returns { pushed, pulled, changedLocal }
export async function syncNow(): Promise<{ pushed: number; pulled: number; changedLocal: boolean }> {
  const config = loadConfig();

  if (!config.enabled) {
    return { pushed: 0, pulled: 0, changedLocal: false };
  }

  // Single-flight: ignore concurrent calls
  if (isSyncing) {
    return { pushed: 0, pulled: 0, changedLocal: false };
  }
  isSyncing = true;

  try {
    const nowIso = new Date().toISOString();

    // Load workspace snapshot
    const snapshot = await loadWorkspace();

    // Load shadow
    const shadow = loadShadow();

    let adoptedServerSettings = false;
    // First sync on this device: if the server already has settings, keep the server's
    // (a fresh install's default settings would otherwise win on updatedAt).
    if (config.lastSeq === 0 && Object.keys(shadow).length === 0) {
      const probe = await callServer(config.url, '/api/sync/pull?since=0', {
        headers: { Authorization: buildAuthHeader(config.key) },
      });
      const probeResult = await probe.json();
      const serverSettings = (probeResult.changes || []).find(
        (c: { kind: string; deleted: unknown }) => c.kind === 'settings' && !c.deleted
      );
      if (serverSettings) {
        snapshot.settings = serverSettings.data;
        shadow['settings:app_settings'] = {
          h: hashItem(serverSettings.data),
          u: serverSettings.updatedAt,
        };
        await replaceWorkspace(snapshot);
        adoptedServerSettings = true;
      }
    }

    // Compute outgoing changes
    const { changes, snapshot: bumpedSnapshot } = computeOutgoing(snapshot, shadow, nowIso);

    let pushed = 0;
    let pulled = 0;
    let changedLocal = false;

    // Push changes if any
    if (changes.length > 0) {
      const response = await callServer(config.url, '/api/sync/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: buildAuthHeader(config.key),
        },
        body: JSON.stringify({ changes }),
      });

      const result = await response.json();
      pushed = result.applied?.length || 0;

    }

    // Pull changes since lastSeq
    const pullResponse = await callServer(config.url, `/api/sync/pull?since=${config.lastSeq}`, {
      headers: { Authorization: buildAuthHeader(config.key) },
    });

    const pullResult = await pullResponse.json();
    const incomingChanges = pullResult.changes || [];
    pulled = incomingChanges.length;
    const newSeq = pullResult.seq || config.lastSeq;

    // Re-read workspace right before writing (to not lose edits made during request)
    const freshSnapshot = await loadWorkspace();

    // Re-apply the bumped updatedAt values from bumpedSnapshot for items unchanged since
    // (items that were changed locally but not sent to server)
    const finalSnapshot = { ...freshSnapshot };
    for (const { kind, id, item } of Object.entries(bumpedSnapshot).length > 0
      ? [
          { kind: 'settings' as const, id: 'app_settings' as const, item: bumpedSnapshot.settings },
          ...bumpedSnapshot.workCycles.map((c) => ({ kind: 'workCycle' as const, id: c.id, item: c })),
          ...bumpedSnapshot.sprints.map((s) => ({ kind: 'sprint' as const, id: s.id, item: s })),
          ...bumpedSnapshot.tasks.map((t) => ({ kind: 'task' as const, id: t.id, item: t })),
        ]
      : []
    ) {
      // Find the corresponding item in freshSnapshot
      let existingItem: any = null;
      if (kind === 'settings') {
        existingItem = finalSnapshot.settings;
      } else if (kind === 'workCycle') {
        existingItem = finalSnapshot.workCycles.find((c) => c.id === id);
      } else if (kind === 'sprint') {
        existingItem = finalSnapshot.sprints.find((s) => s.id === id);
      } else if (kind === 'task') {
        existingItem = finalSnapshot.tasks.find((t) => t.id === id);
      }

      if (existingItem) {
        // If the existing item's updatedAt matches what we had (not changed by server),
        // apply the bumped value
        const localDate = new Date(existingItem.updatedAt).getTime();
        const bumpedDate = new Date((item as any).updatedAt).getTime();

        // Only replace if our bumped value is newer than what fresh has
        if (localDate < bumpedDate) {
          if (kind === 'settings') {
            finalSnapshot.settings = item;
          } else if (kind === 'workCycle') {
            finalSnapshot.workCycles = finalSnapshot.workCycles.map((c) =>
              c.id === id ? item : c
            );
          } else if (kind === 'sprint') {
            finalSnapshot.sprints = finalSnapshot.sprints.map((s) =>
              s.id === id ? item : s
            );
          } else if (kind === 'task') {
            finalSnapshot.tasks = finalSnapshot.tasks.map((t) =>
              t.id === id ? item : t
            );
          }
        }
      }
    }

    // Apply incoming changes
    const { snapshot: appliedSnapshot, changed } = applyIncoming(finalSnapshot, incomingChanges);
    changedLocal = changed || adoptedServerSettings;

    // If anything changed, save the workspace
    if (changedLocal) {
      await replaceWorkspace(appliedSnapshot);
    }

    // Build shadow from final snapshot
    const newShadow = buildShadow(appliedSnapshot);

    // Update config and shadow
    saveConfig({
      lastSeq: newSeq,
      lastSyncedAt: new Date().toISOString(),
    });
    saveShadow(newShadow);

    return { pushed, pulled, changedLocal };
  } catch (err) {
    throw err;
  } finally {
    isSyncing = false;
  }
}

// Delete cloud copy
export async function deleteCloudCopy(): Promise<void> {
  const config = loadConfig();

  if (config.enabled && config.url && config.key) {
    try {
      await callServer(config.url, '/api/sync/all', {
        method: 'DELETE',
        headers: { Authorization: buildAuthHeader(config.key) },
      });
    } catch {
      // Continue even if delete fails
    }
  }

  // Reset local config
  saveConfig({
    enabled: false,
    lastSeq: 0,
  });
  clearShadow();
}
