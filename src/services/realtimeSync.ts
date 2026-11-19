import { Unsubscribe } from 'firebase/firestore';
import {
  AppUser,
  Car,
  RealtimeSyncSnapshot,
  ScanRecord,
  Student,
  SyncConnectionStatus,
  SystemSetting,
} from '../types';
import {
  CollectionSnapshotMeta,
  auth,
  ensureDatabaseSeededIfEmpty,
  fetchCarsFromFirebase,
  fetchScansFromFirebase,
  fetchSettingsFromFirebase,
  fetchStudentsFromFirebase,
  fetchUsersFromFirebase,
  getDeviceOperatorId,
  getPendingCars,
  getPendingScans,
  getPendingStudents,
  isFirebaseReady,
  mergeCarsWithPending,
  mergeScansWithPending,
  mergeStudentsWithPending,
  registerDeviceTerminal,
  subscribeToCarsRealtime,
  subscribeToScansRealtime,
  subscribeToSettingsRealtime,
  subscribeToStudentsRealtime,
  subscribeToUsersRealtime,
  syncPendingCars,
  syncPendingScans,
  syncPendingStudents,
  testConnection,
} from './firebaseClient';

type DataListener<T> = (data: T, meta?: CollectionSnapshotMeta) => void;
type ErrorListener = (err: unknown) => void;
type StatusListener = (snapshot: RealtimeSyncSnapshot) => void;

interface CollectionMetaState {
  loaded: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

class GlobalRealtimeSyncManager {
  private studentsListeners = new Set<{ onData: DataListener<Student[]>; onError?: ErrorListener }>();
  private carsListeners = new Set<{ onData: DataListener<Car[]>; onError?: ErrorListener }>();
  private scansListeners = new Set<{ onData: DataListener<ScanRecord[]>; onError?: ErrorListener }>();
  private usersListeners = new Set<{ onData: DataListener<AppUser[]>; onError?: ErrorListener }>();
  private settingsListeners = new Set<{ onData: DataListener<SystemSetting[]>; onError?: ErrorListener }>();
  private statusListeners = new Set<StatusListener>();

  private unsubStudents: Unsubscribe | null = null;
  private unsubCars: Unsubscribe | null = null;
  private unsubScans: Unsubscribe | null = null;
  private unsubUsers: Unsubscribe | null = null;
  private unsubSettings: Unsubscribe | null = null;

  private activeScansLimit = 50;
  private latestStudents: Student[] | null = null;
  private latestCars: Car[] | null = null;
  private latestScans: ScanRecord[] | null = null;
  private latestUsers: AppUser[] | null = null;
  private latestSettings: SystemSetting[] | null = null;

  private studentsMeta: CollectionMetaState = { loaded: false, fromCache: false, hasPendingWrites: false };
  private carsMeta: CollectionMetaState = { loaded: false, fromCache: false, hasPendingWrites: false };
  private scansMeta: CollectionMetaState = { loaded: false, fromCache: false, hasPendingWrites: false };
  private usersMeta: CollectionMetaState = { loaded: false, fromCache: false, hasPendingWrites: false };
  private settingsMeta: CollectionMetaState = { loaded: false, fromCache: false, hasPendingWrites: false };

  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isFirebaseConnected = isFirebaseReady();
  private isBooting = false;
  private isForcingSync = false;
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;
  private deviceRole: 'Admin' | 'Staff' | 'Viewer' = 'Staff';
  private hasAutoSeeded = false;
  private bootPromise: Promise<void> | null = null;
  private networkAttached = false;

  constructor() {
    this.attachNetworkWatchers();
  }

  private attachNetworkWatchers() {
    if (this.networkAttached || typeof window === 'undefined') return;
    this.networkAttached = true;

    window.addEventListener('online', () => {
      this.isOnline = true;
      this.lastError = null;
      this.emitStatus();
      void this.handleReconnect();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.isFirebaseConnected = false;
      this.emitStatus();
    });
  }

  private async handleReconnect() {
    if (!isFirebaseReady()) return;
    try {
      const conn = await testConnection();
      this.isFirebaseConnected = conn.online;
      await Promise.all([syncPendingCars(), syncPendingStudents(), syncPendingScans()]);
      this.lastSyncedAt = Date.now();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.emitStatus();
    }
  }

  private computeActiveListenerCount(): number {
    return (
      (this.unsubStudents ? 1 : 0) +
      (this.unsubCars ? 1 : 0) +
      (this.unsubScans ? 1 : 0) +
      (this.unsubUsers ? 1 : 0) +
      (this.unsubSettings ? 1 : 0)
    );
  }

  public getSnapshot(): RealtimeSyncSnapshot {
    const localPendingCount =
      getPendingScans().length + getPendingCars().length + getPendingStudents().length;

    const anyPendingWrites =
      this.studentsMeta.hasPendingWrites ||
      this.carsMeta.hasPendingWrites ||
      this.scansMeta.hasPendingWrites ||
      this.usersMeta.hasPendingWrites ||
      this.settingsMeta.hasPendingWrites ||
      localPendingCount > 0;

    const anyFromCache =
      (this.studentsMeta.loaded && this.studentsMeta.fromCache) ||
      (this.carsMeta.loaded && this.carsMeta.fromCache) ||
      (this.scansMeta.loaded && this.scansMeta.fromCache);

    const isInitialLoading =
      !this.studentsMeta.loaded || !this.carsMeta.loaded || !this.scansMeta.loaded;

    let status: SyncConnectionStatus = 'connected';
    if (!this.isOnline) {
      status = 'offline';
    } else if (this.lastError && !this.isFirebaseConnected) {
      status = 'error';
    } else if (anyPendingWrites) {
      status = 'pending';
    } else if (this.isBooting || this.isForcingSync || isInitialLoading) {
      status = 'syncing';
    } else if (!this.isFirebaseConnected) {
      status = 'error';
    }

    return {
      status,
      isOnline: this.isOnline,
      isFirebaseConnected: this.isFirebaseConnected,
      isInitialLoading,
      studentsLoaded: this.studentsMeta.loaded,
      carsLoaded: this.carsMeta.loaded,
      scansLoaded: this.scansMeta.loaded,
      usersLoaded: this.usersMeta.loaded,
      settingsLoaded: this.settingsMeta.loaded,
      fromCache: anyFromCache,
      hasPendingWrites: anyPendingWrites,
      pendingWritesCount: localPendingCount,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      deviceId: getDeviceOperatorId(),
      deviceRole: this.deviceRole,
      authUid: auth.currentUser?.uid ?? null,
      activeListeners: this.computeActiveListenerCount(),
    };
  }

  private emitStatus() {
    const snap = this.getSnapshot();
    this.statusListeners.forEach((listener) => {
      try {
        listener(snap);
      } catch {
        // Ignore individual UI subscriber errors
      }
    });
  }

  public subscribeSyncStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public async initBoot(onSeedProgress?: (step: string) => void): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    if (!isFirebaseReady()) return;

    this.bootPromise = (async () => {
      this.isBooting = true;
      this.emitStatus();

      try {
        const [conn] = await Promise.all([
          testConnection(),
          registerDeviceTerminal(this.deviceRole).catch(() => null),
        ]);
        this.isFirebaseConnected = conn.online;
        if (!conn.online) {
          this.lastError = conn.message;
        } else {
          this.lastError = null;
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
      }

      try {
        await Promise.all([syncPendingCars(), syncPendingStudents(), syncPendingScans()]);
      } catch {
        // Pending queue remains durable and will retry
      }

      if (!this.hasAutoSeeded) {
        this.hasAutoSeeded = true;
        try {
          await ensureDatabaseSeededIfEmpty((p) => {
            onSeedProgress?.(p.step);
          });
        } catch (err) {
          console.warn('Auto-seed check notice:', err);
        }
      }

      this.isBooting = false;
      this.emitStatus();
    })();

    try {
      await this.bootPromise;
    } finally {
      this.bootPromise = null;
    }
  }

  public async setDeviceRole(role: 'Admin' | 'Staff' | 'Viewer'): Promise<void> {
    this.deviceRole = role;
    this.emitStatus();
    await registerDeviceTerminal(role).catch(() => null);
  }

  public async forceResyncAll(scansLimit = this.activeScansLimit): Promise<{
    students: Student[];
    cars: Car[];
    scans: ScanRecord[];
    users: AppUser[];
    settings: SystemSetting[];
  }> {
    this.isForcingSync = true;
    this.emitStatus();
    try {
      await Promise.all([syncPendingCars(), syncPendingStudents(), syncPendingScans()]);
      const [stuRes, carRes, scanRes, userList, settingList] = await Promise.all([
        fetchStudentsFromFirebase(),
        fetchCarsFromFirebase(),
        fetchScansFromFirebase(scansLimit),
        fetchUsersFromFirebase(),
        fetchSettingsFromFirebase(),
      ]);

      const students = mergeStudentsWithPending(stuRes.data);
      const cars = mergeCarsWithPending(carRes.data);
      const scans = mergeScansWithPending(scanRes.data);

      this.latestStudents = students;
      this.latestCars = cars;
      this.latestScans = scans;
      this.latestUsers = userList;
      this.latestSettings = settingList;
      this.studentsMeta = { loaded: true, fromCache: false, hasPendingWrites: false };
      this.carsMeta = { loaded: true, fromCache: false, hasPendingWrites: false };
      this.scansMeta = { loaded: true, fromCache: false, hasPendingWrites: false };
      this.usersMeta = { loaded: true, fromCache: false, hasPendingWrites: false };
      this.settingsMeta = { loaded: true, fromCache: false, hasPendingWrites: false };
      this.isFirebaseConnected = true;
      this.lastSyncedAt = Date.now();
      this.lastError = null;

      return { students, cars, scans, users: userList, settings: settingList };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.isForcingSync = false;
      this.emitStatus();
    }
  }

  public subscribeStudents(
    onData: DataListener<Student[]>,
    onError?: ErrorListener
  ): Unsubscribe {
    const entry = { onData, onError };
    this.studentsListeners.add(entry);

    if (this.latestStudents) {
      onData(this.latestStudents, {
        fromCache: this.studentsMeta.fromCache,
        hasPendingWrites: this.studentsMeta.hasPendingWrites,
        docCount: this.latestStudents.length,
      });
    }

    if (!this.unsubStudents && isFirebaseReady()) {
      this.unsubStudents = subscribeToStudentsRealtime(
        (rows, meta) => {
          const merged = mergeStudentsWithPending(rows);
          this.latestStudents = merged;
          this.studentsMeta = {
            loaded: true,
            fromCache: meta.fromCache,
            hasPendingWrites: meta.hasPendingWrites,
          };
          this.isFirebaseConnected = true;
          this.lastError = null;
          if (!meta.fromCache && !meta.hasPendingWrites) {
            this.lastSyncedAt = Date.now();
          }
          this.studentsListeners.forEach((l) => l.onData(merged, meta));
          this.emitStatus();
        },
        (err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.isFirebaseConnected = false;
          this.studentsListeners.forEach((l) => l.onError?.(err));
          this.emitStatus();
        }
      );
      this.emitStatus();
    }

    return () => {
      this.studentsListeners.delete(entry);
      if (this.studentsListeners.size === 0 && this.unsubStudents) {
        this.unsubStudents();
        this.unsubStudents = null;
        this.emitStatus();
      }
    };
  }

  public subscribeCars(onData: DataListener<Car[]>, onError?: ErrorListener): Unsubscribe {
    const entry = { onData, onError };
    this.carsListeners.add(entry);

    if (this.latestCars) {
      onData(this.latestCars, {
        fromCache: this.carsMeta.fromCache,
        hasPendingWrites: this.carsMeta.hasPendingWrites,
        docCount: this.latestCars.length,
      });
    }

    if (!this.unsubCars && isFirebaseReady()) {
      this.unsubCars = subscribeToCarsRealtime(
        (rows, meta) => {
          const merged = mergeCarsWithPending(rows);
          this.latestCars = merged;
          this.carsMeta = {
            loaded: true,
            fromCache: meta.fromCache,
            hasPendingWrites: meta.hasPendingWrites,
          };
          this.isFirebaseConnected = true;
          this.lastError = null;
          if (!meta.fromCache && !meta.hasPendingWrites) {
            this.lastSyncedAt = Date.now();
          }
          this.carsListeners.forEach((l) => l.onData(merged, meta));
          this.emitStatus();
        },
        (err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.isFirebaseConnected = false;
          this.carsListeners.forEach((l) => l.onError?.(err));
          this.emitStatus();
        }
      );
      this.emitStatus();
    }

    return () => {
      this.carsListeners.delete(entry);
      if (this.carsListeners.size === 0 && this.unsubCars) {
        this.unsubCars();
        this.unsubCars = null;
        this.emitStatus();
      }
    };
  }

  public subscribeScans(
    limitCount: number,
    onData: DataListener<ScanRecord[]>,
    onError?: ErrorListener
  ): Unsubscribe {
    const normalizedLimit = Math.min(10000, Math.max(1, limitCount || 50));
    const entry = { onData, onError };
    this.scansListeners.add(entry);

    const needsRestart =
      !this.unsubScans || normalizedLimit !== this.activeScansLimit;

    if (this.latestScans && !needsRestart) {
      onData(this.latestScans, {
        fromCache: this.scansMeta.fromCache,
        hasPendingWrites: this.scansMeta.hasPendingWrites,
        docCount: this.latestScans.length,
      });
    }

    if (needsRestart && isFirebaseReady()) {
      if (this.unsubScans) {
        this.unsubScans();
        this.unsubScans = null;
      }
      this.activeScansLimit = normalizedLimit;
      this.unsubScans = subscribeToScansRealtime(
        normalizedLimit,
        (rows, meta) => {
          const merged = mergeScansWithPending(rows);
          this.latestScans = merged;
          this.scansMeta = {
            loaded: true,
            fromCache: meta.fromCache,
            hasPendingWrites: meta.hasPendingWrites,
          };
          this.isFirebaseConnected = true;
          this.lastError = null;
          if (!meta.fromCache && !meta.hasPendingWrites) {
            this.lastSyncedAt = Date.now();
          }
          this.scansListeners.forEach((l) => l.onData(merged, meta));
          this.emitStatus();
        },
        (err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.isFirebaseConnected = false;
          this.scansListeners.forEach((l) => l.onError?.(err));
          this.emitStatus();
        }
      );
      this.emitStatus();
    }

    return () => {
      this.scansListeners.delete(entry);
      if (this.scansListeners.size === 0 && this.unsubScans) {
        this.unsubScans();
        this.unsubScans = null;
        this.emitStatus();
      }
    };
  }

  public subscribeUsers(
    onData: DataListener<AppUser[]>,
    onError?: ErrorListener
  ): Unsubscribe {
    const entry = { onData, onError };
    this.usersListeners.add(entry);

    if (this.latestUsers) {
      onData(this.latestUsers, {
        fromCache: this.usersMeta.fromCache,
        hasPendingWrites: this.usersMeta.hasPendingWrites,
        docCount: this.latestUsers.length,
      });
    }

    if (!this.unsubUsers && isFirebaseReady()) {
      this.unsubUsers = subscribeToUsersRealtime(
        (rows, meta) => {
          this.latestUsers = rows;
          this.usersMeta = {
            loaded: true,
            fromCache: meta.fromCache,
            hasPendingWrites: meta.hasPendingWrites,
          };
          this.isFirebaseConnected = true;
          this.usersListeners.forEach((l) => l.onData(rows, meta));
          this.emitStatus();
        },
        (err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.usersListeners.forEach((l) => l.onError?.(err));
          this.emitStatus();
        }
      );
      this.emitStatus();
    }

    return () => {
      this.usersListeners.delete(entry);
      if (this.usersListeners.size === 0 && this.unsubUsers) {
        this.unsubUsers();
        this.unsubUsers = null;
        this.emitStatus();
      }
    };
  }

  public subscribeSettings(
    onData: DataListener<SystemSetting[]>,
    onError?: ErrorListener
  ): Unsubscribe {
    const entry = { onData, onError };
    this.settingsListeners.add(entry);

    if (this.latestSettings) {
      onData(this.latestSettings, {
        fromCache: this.settingsMeta.fromCache,
        hasPendingWrites: this.settingsMeta.hasPendingWrites,
        docCount: this.latestSettings.length,
      });
    }

    if (!this.unsubSettings && isFirebaseReady()) {
      this.unsubSettings = subscribeToSettingsRealtime(
        (rows, meta) => {
          this.latestSettings = rows;
          this.settingsMeta = {
            loaded: true,
            fromCache: meta.fromCache,
            hasPendingWrites: meta.hasPendingWrites,
          };
          this.isFirebaseConnected = true;
          this.settingsListeners.forEach((l) => l.onData(rows, meta));
          this.emitStatus();
        },
        (err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          this.settingsListeners.forEach((l) => l.onError?.(err));
          this.emitStatus();
        }
      );
      this.emitStatus();
    }

    return () => {
      this.settingsListeners.delete(entry);
      if (this.settingsListeners.size === 0 && this.unsubSettings) {
        this.unsubSettings();
        this.unsubSettings = null;
        this.emitStatus();
      }
    };
  }

  public notifyPendingChanged(): void {
    this.emitStatus();
  }

  public cleanupAll(): void {
    this.unsubStudents?.();
    this.unsubStudents = null;
    this.unsubCars?.();
    this.unsubCars = null;
    this.unsubScans?.();
    this.unsubScans = null;
    this.unsubUsers?.();
    this.unsubUsers = null;
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.studentsListeners.clear();
    this.carsListeners.clear();
    this.scansListeners.clear();
    this.usersListeners.clear();
    this.settingsListeners.clear();
    this.emitStatus();
  }
}

export const realtimeSyncManager = new GlobalRealtimeSyncManager();

export function subscribeStudents(
  onData: DataListener<Student[]>,
  onError?: ErrorListener
): Unsubscribe {
  return realtimeSyncManager.subscribeStudents(onData, onError);
}

export function subscribeCars(
  onData: DataListener<Car[]>,
  onError?: ErrorListener
): Unsubscribe {
  return realtimeSyncManager.subscribeCars(onData, onError);
}

export function subscribeScans(
  limitCount: number,
  onData: DataListener<ScanRecord[]>,
  onError?: ErrorListener
): Unsubscribe {
  return realtimeSyncManager.subscribeScans(limitCount, onData, onError);
}

export function subscribeUsers(
  onData: DataListener<AppUser[]>,
  onError?: ErrorListener
): Unsubscribe {
  return realtimeSyncManager.subscribeUsers(onData, onError);
}

export function subscribeSettings(
  onData: DataListener<SystemSetting[]>,
  onError?: ErrorListener
): Unsubscribe {
  return realtimeSyncManager.subscribeSettings(onData, onError);
}

export function subscribeSyncStatus(listener: StatusListener): Unsubscribe {
  return realtimeSyncManager.subscribeSyncStatus(listener);
}

export function getConnectionSnapshot(): RealtimeSyncSnapshot {
  return realtimeSyncManager.getSnapshot();
}

export function initGlobalRealtimeSync(onSeedProgress?: (step: string) => void): Promise<void> {
  return realtimeSyncManager.initBoot(onSeedProgress);
}

export function forceResyncAll(scansLimit?: number) {
  return realtimeSyncManager.forceResyncAll(scansLimit);
}

export function setDeviceSessionRole(role: 'Admin' | 'Staff' | 'Viewer'): Promise<void> {
  return realtimeSyncManager.setDeviceRole(role);
}

export function notifySyncQueueChanged(): void {
  realtimeSyncManager.notifyPendingChanged();
}

export function cleanupAllRealtimeListeners(): void {
  realtimeSyncManager.cleanupAll();
}
