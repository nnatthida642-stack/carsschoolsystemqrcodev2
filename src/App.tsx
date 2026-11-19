import React, { useState, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import { SplashScreen } from './components/SplashScreen';
import { CameraHalf } from './components/CameraHalf';
import { ScanListHalf } from './components/ScanListHalf';
import { CardDetailModal } from './components/CardDetailModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { AdminDashboard } from './components/AdminDashboard';
import { FirebaseAuthModal } from './components/FirebaseAuthModal';
import { TestScanModal } from './components/TestScanModal';
import { formatThaiDateTime } from './data/mockData';
import { speakFastSuccess, triggerVibration } from './utils/audio';
import { getInstantCoordinates, warmUpCoordinates } from './utils/geo';
import { normalizeScannedPayload } from './utils/barcode';
import { Student, ScanRecord, Car, AdminTab, AppUser, SystemSetting, RealtimeSyncSnapshot } from './types';
import {
  DEFAULT_APPS_SCRIPT_URL,
  syncToAppsScriptWebhook,
  appendScansToSheet,
  fetchStudentsFromAppsScript,
  fetchCarsFromAppsScript,
  fetchScansFromAppsScript,
} from './services/googleSheets';
import { getAccessToken } from './services/googleAuth';
import {
  getDeviceOperatorId,
  isFirebaseReady,
  findStudentInFirestoreByCode,
  upsertStudentToFirebase,
  deleteStudentFromFirebase,
  upsertCarToFirebase,
  deleteCarFromFirebase,
  insertScanToFirebase,
  deleteScanFromFirebase,
  clearAllScansInFirebase,
  upsertUserToFirebase,
  deleteUserFromFirebase,
  upsertSettingToFirebase,
  deleteSettingFromFirebase,
  importStudentsBatchToFirebase,
  syncPendingScans,
  getPendingScans,
  removePendingScan,
  clearPendingScans,
  mergeScansWithPending,
  getPendingCars,
  savePendingCar,
  removePendingCar,
  syncPendingCars,
  getPendingStudents,
  savePendingStudent,
  removePendingStudent,
  syncPendingStudents,
} from './services/firebaseClient';
import {
  forceResyncAll,
  getConnectionSnapshot,
  initGlobalRealtimeSync,
  notifySyncQueueChanged,
  setDeviceSessionRole,
  subscribeCars,
  subscribeScans,
  subscribeSettings,
  subscribeStudents,
  subscribeSyncStatus,
  subscribeUsers,
} from './services/realtimeSync';

function deduplicateAndFixScanIds(records: ScanRecord[]): ScanRecord[] {
  const seenIds = new Set<string>();
  return records.map((scan, index) => {
    let id = scan.id;
    if (!id || seenIds.has(id)) {
      const typeSuffix = scan.scanType === 'ลงรถ' ? 'drop' : 'pickup';
      id = `${scan.id || 'SC'}-${typeSuffix}-${index + 1}`;
      if (seenIds.has(id)) {
        id = `${id}-${index + 1}`;
      }
    }
    seenIds.add(id);
    return {
      ...scan,
      id,
      scanId: scan.scanId && scan.scanId !== scan.id && !seenIds.has(scan.scanId) ? scan.scanId : id,
    };
  });
}

const DUPLICATE_SCAN_GUARD_MS = 10000;
const STORAGE_KEY_RECENT_SCAN_LOCKS = 'qr_bus_recent_scan_locks_v1';

function hashQrTextDeterministic(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().slice(0, 6);
}

function readPersistedScanLocks(now: number): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof window === 'undefined') return map;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT_SCAN_LOCKS);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as Record<string, number>;
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && now - ts < DUPLICATE_SCAN_GUARD_MS) {
        map.set(k, ts);
      }
    }
  } catch {
    // Ignore storage read error
  }
  return map;
}

function writePersistedScanLocks(map: Map<string, number>, now: number): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, number> = {};
    for (const [k, ts] of map.entries()) {
      if (now - ts < DUPLICATE_SCAN_GUARD_MS) {
        obj[k] = ts;
      }
    }
    localStorage.setItem(STORAGE_KEY_RECENT_SCAN_LOCKS, JSON.stringify(obj));
  } catch {
    // Ignore storage write error
  }
}

function resolveStudentFromQrText(
  rawText: string,
  studentList: Student[]
): { student: Student; studentKey: string; rawKey: string } {
  let rawClean = normalizeScannedPayload(rawText, studentList);

  if (rawClean.includes('text=')) {
    try {
      const url = new URL(rawClean);
      rawClean = url.searchParams.get('text') || rawClean;
    } catch {
      const m = rawClean.match(/text=([^&]+)/);
      if (m) rawClean = decodeURIComponent(m[1]);
    }
  }

  let matchedStudent: Student | undefined;

  try {
    const parsed = JSON.parse(rawClean);
    if (parsed && (parsed.code || parsed.studentCode || parsed.studentID)) {
      const targetCode = String(parsed.code || parsed.studentCode || parsed.studentID)
        .trim()
        .toUpperCase();
      matchedStudent = studentList.find(
        (s) => s.studentCode.trim().toUpperCase() === targetCode || s.id.trim().toUpperCase() === targetCode
      );
      if (!matchedStudent) {
        matchedStudent = {
          id: targetCode,
          studentCode: targetCode,
          name: parsed.name || 'พนักงานทั่วไป',
          grade: parsed.grade || 'แผนกทั่วไป',
          className: parsed.classroom || parsed.grade || 'แผนกทั่วไป',
          dorm: parsed.dorm || 'หอ A',
          carID: parsed.carID || 'CAR01',
          busNumber: parsed.bus || parsed.carID || 'CAR01',
          dormOrStop: parsed.dorm || 'จุดรับส่งพนักงาน',
          parentPhone: parsed.parentPhone || '081-000-0000',
          avatarColor: 'bg-indigo-500',
        };
      }
    }
  } catch {
    const textUpper = rawClean.toUpperCase();
    matchedStudent = studentList.find(
      (s) =>
        s.studentCode.trim().toUpperCase() === textUpper ||
        s.id.trim().toUpperCase() === textUpper ||
        s.name.includes(rawClean) ||
        (s.nickname && s.nickname.toLowerCase() === rawClean.toLowerCase())
    );

    if (!matchedStudent && /^\d+$/.test(rawClean)) {
      const padded = 'STD' + String(parseInt(rawClean, 10)).padStart(4, '0');
      matchedStudent = studentList.find((s) => s.studentCode.toUpperCase() === padded);
    }
  }

  if (!matchedStudent) {
    const alnum = rawClean.replace(/[^A-Za-z0-9]/g, '').slice(0, 7).toUpperCase();
    const fallbackCode = alnum || `STD_${hashQrTextDeterministic(rawClean)}`;
    matchedStudent = {
      id: fallbackCode,
      studentCode: fallbackCode,
      name:
        rawClean.length > 2 && !rawClean.startsWith('http')
          ? rawClean
          : `พนักงานรหัส ${fallbackCode}`,
      grade: 'แผนกทั่วไป',
      dorm: 'หอ A',
      carID: 'CAR01',
      busNumber: 'CAR01',
      dormOrStop: 'จุดรับส่งพนักงาน',
      parentPhone: '089-111-2233',
      avatarColor: 'bg-emerald-500',
    };
  }

  const studentKey = (matchedStudent.studentCode || matchedStudent.id || '').trim().toUpperCase();
  const rawKey = `RAW:${rawClean.toUpperCase()}`;
  return { student: matchedStudent, studentKey, rawKey };
}

// Auto-purge any legacy Supabase or mock data keys from localStorage (100% Firebase Firestore)
if (typeof window !== 'undefined') {
  try {
    const PURGE_KEY = 'qr_bus_firebase_migration_purged_v1';
    if (!localStorage.getItem(PURGE_KEY)) {
      localStorage.removeItem('qr_bus_supabase_url');
      localStorage.removeItem('qr_bus_supabase_anon_key');
      localStorage.removeItem('qr_bus_pending_scans');
      localStorage.removeItem('bus_students');
      localStorage.removeItem('bus_cars');
      localStorage.removeItem('bus_scans');
      localStorage.setItem(PURGE_KEY, 'done');
    }
  } catch (err) {
    console.warn('Storage purge warning:', err);
  }
}

export default function App() {
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<string>('09:41');
  const [toastMsg, setToastMsg] = useState<string>('');

  // Network & Firebase Cloud Data States (100% Firestore Driven, Shared Multi-Device Without Login)
  const [syncSnapshot, setSyncSnapshot] = useState<RealtimeSyncSnapshot>(() => getConnectionSnapshot());
  const isOnline = syncSnapshot.isOnline;
  const isFirebaseConnected = syncSnapshot.isFirebaseConnected;
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [students, setStudents] = useState<Student[]>(() => getPendingStudents());
  const [cars, setCars] = useState<Car[]>(() => getPendingCars());
  const [scans, setScans] = useState<ScanRecord[]>(() => getPendingScans());
  const [scansLimit, setScansLimit] = useState<number>(50);
  const [hasMoreScans, setHasMoreScans] = useState<boolean>(false);
  const [isLoadingMoreScans, setIsLoadingMoreScans] = useState<boolean>(false);
  const [isSavingScan, setIsSavingScan] = useState<boolean>(false);
  const [latestRemoteScanId, setLatestRemoteScanId] = useState<string | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [settings, setSettings] = useState<SystemSetting[]>([]);

  const [activeScan, setActiveScan] = useState<ScanRecord | null>(null);
  const [selectedScanDetail, setSelectedScanDetail] = useState<ScanRecord | null>(null);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState<boolean>(false);
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState<boolean>(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState<boolean>(false);
  const [isTestScanModalOpen, setIsTestScanModalOpen] = useState<boolean>(false);
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>('dashboard');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isSyncingSheets, setIsSyncingSheets] = useState<boolean>(false);
  const [isSyncingFirebase, setIsSyncingFirebase] = useState<boolean>(false);

  const recentStudentScanRef = useRef<Map<string, number>>(readPersistedScanLocks(Date.now()));
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const scansRef = useRef<ScanRecord[]>(scans);
  const studentsRef = useRef<Student[]>(students);
  const carsRef = useRef<Car[]>(cars);
  const usersRef = useRef<AppUser[]>(users);
  const settingsRef = useRef<SystemSetting[]>(settings);
  const seenScanIdsRef = useRef<Set<string>>(new Set());
  const localCreatedScanIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedInitialScansRef = useRef<boolean>(false);

  useEffect(() => {
    scansRef.current = scans;
  }, [scans]);

  useEffect(() => {
    studentsRef.current = students;
  }, [students]);

  useEffect(() => {
    carsRef.current = cars;
  }, [cars]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Google Sheets & Apps Script State
  const [appsScriptUrl, setAppsScriptUrl] = useState<string>(() => {
    return localStorage.getItem('gas_webhook_url') || DEFAULT_APPS_SCRIPT_URL;
  });
  const [connectedSheetId, setConnectedSheetId] = useState<string>(() => {
    return localStorage.getItem('gsheet_id') || '';
  });
  const [connectedSheetTitle, setConnectedSheetTitle] = useState<string>(() => {
    return localStorage.getItem('gsheet_title') || '';
  });
  const [connectedSheetUrl, setConnectedSheetUrl] = useState<string>(() => {
    return localStorage.getItem('gsheet_url') || '';
  });
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    return localStorage.getItem('gsheet_autosync') !== 'false';
  });

  // Clock in status bar
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      setCurrentTime(`${h}:${m}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Toast helper
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? '' : curr));
    }, 3200);
  }, []);

  // Persist Sheets settings
  useEffect(() => {
    localStorage.setItem('gas_webhook_url', appsScriptUrl);
  }, [appsScriptUrl]);

  useEffect(() => {
    localStorage.setItem('gsheet_id', connectedSheetId);
  }, [connectedSheetId]);

  useEffect(() => {
    localStorage.setItem('gsheet_title', connectedSheetTitle);
  }, [connectedSheetTitle]);

  useEffect(() => {
    localStorage.setItem('gsheet_url', connectedSheetUrl);
  }, [connectedSheetUrl]);

  useEffect(() => {
    localStorage.setItem('gsheet_autosync', String(autoSyncEnabled));
  }, [autoSyncEnabled]);

  const handleUpdateConnectedSheetId = (id: string, url: string, title?: string) => {
    setConnectedSheetId(id);
    setConnectedSheetUrl(url);
    if (title) setConnectedSheetTitle(title);
  };

  // Warm up GPS cache in background on mount
  useEffect(() => {
    warmUpCoordinates();
  }, []);

  // ==========================================
  // SHARED REALTIME FIRESTORE SYNC (CENTRALIZED SERVICE, NO LOGIN REQUIRED)
  // ==========================================
  const refreshFromFirebase = useCallback(
    async (silent = false) => {
      if (!isFirebaseReady()) return;
      setIsSyncingFirebase(true);
      try {
        const res = await forceResyncAll(scansLimit);
        setStudents(res.students);
        setCars(res.cars);
        const uniqueScans = deduplicateAndFixScanIds(res.scans);
        setScans(uniqueScans);
        setHasMoreScans(res.scans.length >= scansLimit);
        setUsers(res.users);
        setSettings(res.settings);

        if (!silent) {
          showToast(
            `🔥 ซิงค์ข้อมูลสด Firebase 100%: พนักงาน ${res.students.length} คน • รถ ${res.cars.length} คัน • สแกน ${uniqueScans.length} รายการ`
          );
        }
      } catch (err) {
        console.warn('Failed to fetch from Firebase:', err);
        if (!silent) {
          showToast('ไม่สามารถดึงข้อมูลจาก Firebase ได้ในขณะนี้');
        }
      } finally {
        setIsSyncingFirebase(false);
      }
    },
    [scansLimit, showToast]
  );

  // Boot centralized real-time manager & subscribe to students, cars, users, settings, and global status
  useEffect(() => {
    if (!isFirebaseReady()) return;

    const unsubStatus = subscribeSyncStatus((snap) => {
      setSyncSnapshot(snap);
    });

    void initGlobalRealtimeSync((step) => {
      showToast(`🔥 ${step}`);
    });

    const unsubStudents = subscribeStudents((rows) => {
      setStudents(rows);
    });

    const unsubCars = subscribeCars((rows) => {
      setCars(rows);
    });

    const unsubUsers = subscribeUsers((rows) => {
      setUsers(rows);
    });

    const unsubSettings = subscribeSettings((rows) => {
      setSettings(rows);
      const soundRow = rows.find((s) => s.key === 'sound_enabled' || s.key === 'voice_enabled');
      if (soundRow) {
        setSoundEnabled(soundRow.value !== 'false' && soundRow.value !== '0');
      }
    });

    return () => {
      unsubStatus();
      unsubStudents();
      unsubCars();
      unsubUsers();
      unsubSettings();
    };
  }, [showToast]);

  // Dedicated paginated real-time listener for scans collection via centralized service
  useEffect(() => {
    if (!isFirebaseReady()) return;

    const unsubscribeScans = subscribeScans(
      scansLimit,
      (rows, meta) => {
        setIsLoadingMoreScans(false);
        setHasMoreScans((meta?.docCount ?? rows.length) >= scansLimit);

        const merged = deduplicateAndFixScanIds(mergeScansWithPending(rows));
        if (hasLoadedInitialScansRef.current) {
          const nowTs = Date.now();
          const newRemoteScan = merged.find((s) => {
            const key = s.scanId || s.id;
            return (
              key &&
              !seenScanIdsRef.current.has(key) &&
              !localCreatedScanIdsRef.current.has(key) &&
              typeof s.timestamp === 'number' &&
              Math.abs(nowTs - s.timestamp) < 300000
            );
          });
          if (newRemoteScan) {
            const highlightKey = newRemoteScan.scanId || newRemoteScan.id;
            setLatestRemoteScanId(highlightKey);
            window.setTimeout(() => {
              setLatestRemoteScanId((curr) => (curr === highlightKey ? null : curr));
            }, 6000);
            showToast(
              `📡 ซิงค์รายการสแกนเรียลไทม์: ${newRemoteScan.name} (${newRemoteScan.scanType || 'ขึ้นรถ'})`
            );
          }
        }
        const nextSeen = new Set<string>();
        merged.forEach((s) => {
          const key = s.scanId || s.id;
          if (key) nextSeen.add(key);
        });
        seenScanIdsRef.current = nextSeen;
        hasLoadedInitialScansRef.current = true;
        setScans(merged);
      },
      () => {
        setIsLoadingMoreScans(false);
      }
    );

    return () => {
      unsubscribeScans();
    };
  }, [scansLimit, showToast]);

  // Notify toast when network status transitions
  const prevOnlineRef = useRef<boolean>(isOnline);
  useEffect(() => {
    if (prevOnlineRef.current === isOnline) return;
    prevOnlineRef.current = isOnline;
    if (isOnline) {
      showToast('🟢 กลับมาออนไลน์แล้ว — กำลังซิงค์ข้อมูล Firebase Real-time');
    } else {
      showToast('🟠 โหมดออฟไลน์ — การสแกนจะถูกเก็บคิวรอซิงค์อัตโนมัติ');
    }
  }, [isOnline, showToast]);

  // Google Sheets Fetch
  const refreshFromGoogleSheets = useCallback(
    async (silent = false) => {
      if (!appsScriptUrl) return;
      setIsSyncingSheets(true);
      try {
        const [stuRes, carRes, scanRes] = await Promise.all([
          fetchStudentsFromAppsScript(appsScriptUrl),
          fetchCarsFromAppsScript(appsScriptUrl),
          fetchScansFromAppsScript(appsScriptUrl),
        ]);

        const successItems: string[] = [];

        if (stuRes.success && stuRes.data && stuRes.data.length > 0) {
          setStudents(stuRes.data);
          if (isFirebaseReady()) {
            await importStudentsBatchToFirebase(stuRes.data).catch(() => {});
          }
          successItems.push(`พนักงาน ${stuRes.data.length} คน`);
        }

        if (carRes.success && carRes.data && carRes.data.length > 0) {
          setCars(carRes.data);
          successItems.push(`รถ ${carRes.data.length} คัน`);
        }

        if (scanRes.success && scanRes.data && scanRes.data.length > 0) {
          const uniqueScans = deduplicateAndFixScanIds(scanRes.data);
          setScans(uniqueScans);
          successItems.push(`สแกน ${uniqueScans.length} รายการ`);
        }

        if (successItems.length > 0) {
          showToast(`✓ ซิงค์ Google Sheet: ${successItems.join(' • ')}`);
        } else if (!silent) {
          showToast('✓ เชื่อมต่อ Google Sheet สำเร็จ (ข้อมูลเป็นปัจจุบัน)');
        }
      } catch (err) {
        console.warn('Failed to fetch from Google Sheets:', err);
        if (!silent) {
          showToast('ไม่สามารถดึงข้อมูลจาก Google Apps Script ได้ในขณะนี้');
        }
      } finally {
        setIsSyncingSheets(false);
      }
    },
    [appsScriptUrl, showToast]
  );

  // ==========================================
  // SCAN ACTION (10s ANTI-DUPLICATE + IMMEDIATE FIREBASE SAVE)
  // ==========================================
  const checkDuplicateForKeys = useCallback((keys: string[]): { blocked: boolean; remainSec: number } => {
    const now = Date.now();
    const persisted = readPersistedScanLocks(now);
    for (const [k, ts] of persisted.entries()) {
      const existingTs = recentStudentScanRef.current.get(k) || 0;
      if (ts > existingTs) {
        recentStudentScanRef.current.set(k, ts);
      }
    }
    for (const [k, ts] of recentStudentScanRef.current.entries()) {
      if (now - ts >= DUPLICATE_SCAN_GUARD_MS) {
        recentStudentScanRef.current.delete(k);
      }
    }

    let latestTs = 0;
    const normalizedKeys = keys.map((k) => k.trim().toUpperCase()).filter(Boolean);

    for (const key of normalizedKeys) {
      const refTs = recentStudentScanRef.current.get(key) || 0;
      if (refTs > latestTs) latestTs = refTs;

      if (!key.startsWith('RAW:')) {
        const stateScan = scansRef.current.find((s) => {
          const codeMatch = (s.studentCode || '').trim().toUpperCase() === key;
          const idMatch = (s.studentId || '').trim().toUpperCase() === key;
          return (codeMatch || idMatch) && typeof s.timestamp === 'number';
        });
        if (stateScan?.timestamp && stateScan.timestamp > latestTs) {
          latestTs = stateScan.timestamp;
        }
      }
    }

    if (latestTs > 0 && now - latestTs < DUPLICATE_SCAN_GUARD_MS) {
      const remainSec = Math.max(1, Math.ceil((DUPLICATE_SCAN_GUARD_MS - (now - latestTs)) / 1000));
      return { blocked: true, remainSec };
    }
    return { blocked: false, remainSec: 0 };
  }, []);

  const checkDuplicateBeforeCameraScan = useCallback(
    (rawText: string): { blocked: boolean; remainSec: number; label?: string } => {
      const { student, studentKey, rawKey } = resolveStudentFromQrText(rawText, studentsRef.current);
      const check = checkDuplicateForKeys([studentKey, rawKey]);
      return {
        ...check,
        label: student.name,
      };
    },
    [checkDuplicateForKeys]
  );

  const registerScan = useCallback(
    async (
      student: Student,
      source: 'camera' | 'upload' | 'simulated' | 'barcode_scanner' | 'scanner',
      customScanType?: 'ขึ้นรถ' | 'ลงรถ',
      rawKey?: string
    ) => {
      const now = Date.now();
      const studentKey = (student.studentCode || student.id || '').trim().toUpperCase();
      const lockKeys = [studentKey, rawKey || ''].filter(Boolean);

      // Guard against concurrent double-triggers (rapid Enter / bounce / fast clicks)
      if (lockKeys.some((k) => inFlightKeysRef.current.has(k.toUpperCase()))) {
        showToast(`⏳ กำลังบันทึกข้อมูลของ ${student.name} กรุณารอสักครู่...`);
        return;
      }

      if (lockKeys.length > 0) {
        const dup = checkDuplicateForKeys(lockKeys);
        if (dup.blocked) {
          showToast(`⏳ เพิ่งสแกน ${student.name} ไปแล้ว (รออีก ${dup.remainSec} วินาที)`);
          return;
        }

        for (const k of lockKeys) {
          const upper = k.toUpperCase();
          recentStudentScanRef.current.set(upper, now);
          inFlightKeysRef.current.add(upper);
        }
        writePersistedScanLocks(recentStudentScanRef.current, now);
      }

      const releaseInFlightLocks = () => {
        for (const k of lockKeys) {
          inFlightKeysRef.current.delete(k.toUpperCase());
        }
      };

      const isKnownStudent = studentsRef.current.some(
        (s) => s.studentCode === student.studentCode || s.id === student.id
      );

      setStudents((prev) => {
        const existingIdx = prev.findIndex(
          (s) => s.studentCode === student.studentCode || s.id === student.id
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = { ...updated[existingIdx], ...student };
          return updated;
        }
        return [student, ...prev];
      });

      const geo = getInstantCoordinates();
      const { dateThai, timeThai } = formatThaiDateTime();

      const studentCar = cars.find((c) => c.carID === student.carID || c.carID === student.busNumber);

      const studentScansToday = scansRef.current.filter(
        (s) =>
          (s.studentCode === student.studentCode || s.studentId === student.id) &&
          (s.dateThai === dateThai || !s.dateThai)
      );

      const isDropOff = customScanType
        ? customScanType === 'ลงรถ'
        : studentScansToday.length > 0 &&
          (studentScansToday[0].scanType === 'ขึ้นรถ' || studentScansToday.length % 2 === 1);

      const scanType = customScanType || (isDropOff ? 'ลงรถ' : 'ขึ้นรถ');
      const deviceId = getDeviceOperatorId();

      const resolvedGrade = student.grade || student.className || 'แผนกทั่วไป';
      const resolvedRoom =
        student.room ||
        (student.className && student.className.includes('/') ? student.className.split('/')[1] : '') ||
        '';
      const normalizedSource: ScanRecord['scanSource'] =
        source === 'scanner' ? 'barcode_scanner' : source;

      const scanId = `SCN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const newScan: ScanRecord = {
        id: scanId,
        scanId,
        timestamp: Date.now(),
        dateThai,
        timeThai,
        time: timeThai,
        studentId: student.id || student.studentCode,
        studentCode: student.studentCode || student.id,
        name: student.name,
        grade: resolvedGrade,
        room: resolvedRoom,
        dorm: student.dorm || student.dormOrStop || 'หอ A',
        carID: student.carID || student.busNumber || 'CAR01',
        plate: student.plate || studentCar?.plate || '1กข 1234',
        scanType,
        scannerName: deviceId,
        device: deviceId,
        busNumber: student.busNumber || student.carID || 'CAR01',
        locationName:
          student.pickup_point ||
          student.pickupPoint ||
          student.pickup ||
          student.dormOrStop ||
          student.busStopName ||
          geo.locationName,
        latitude:
          typeof student.latitude === 'number' && !isNaN(student.latitude) && student.latitude !== 0
            ? student.latitude
            : typeof student.lat === 'number' && !isNaN(student.lat)
            ? student.lat
            : geo.latitude,
        longitude:
          typeof student.longitude === 'number' && !isNaN(student.longitude) && student.longitude !== 0
            ? student.longitude
            : typeof student.lng === 'number' && !isNaN(student.lng)
            ? student.lng
            : geo.longitude,
        scanSource: normalizedSource,
        scanResult: isOnline ? 'กำลังบันทึก' : 'รอซิงค์ (ออฟไลน์)',
        status: 'success',
        dbSaved: false,
        syncStatus: 'pending',
        avatar:
          student.avatar ||
          student.avatarUrl ||
          `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(student.studentCode)}`,
      };

      seenScanIdsRef.current.add(newScan.scanId);
      localCreatedScanIdsRef.current.add(newScan.scanId);
      setScans((prev) => [newScan, ...prev]);
      setActiveScan(newScan);
      setIsSavingScan(true);
      showToast(`⏳ กำลังบันทึก: ${student.name} (${scanType})...`);

      // Write deterministically via setDoc(doc(db, 'scans', scanId), payload) + serverTimestamp()
      try {
        const res = await insertScanToFirebase(
          { ...newScan, scanResult: 'สำเร็จ' },
          {
            student: isKnownStudent ? undefined : student,
            isNewScan: true,
            skipStudentUpsert: isKnownStudent,
          }
        );
        notifySyncQueueChanged();

        if (res.success && res.confirmedServer !== false) {
          setScans((prev) =>
            prev.map((s) =>
              s.id === newScan.id || s.scanId === newScan.scanId
                ? {
                    ...s,
                    firestoreDocId: res.docId,
                    dbSaved: true,
                    syncStatus: 'synced',
                    fromCache: false,
                    hasPendingWrites: false,
                    scanResult: 'สำเร็จ',
                    syncError: undefined,
                  }
                : s
            )
          );
          setActiveScan((curr) =>
            curr && (curr.id === newScan.id || curr.scanId === newScan.scanId)
              ? {
                  ...curr,
                  firestoreDocId: res.docId,
                  dbSaved: true,
                  syncStatus: 'synced',
                  fromCache: false,
                  hasPendingWrites: false,
                  scanResult: 'สำเร็จ',
                }
              : curr
          );
          showToast(
            isDropOff
              ? `✓ บันทึกสำเร็จ (${student.name} • ลงรถ)`
              : `✓ บันทึกสำเร็จ (${student.name} • ขึ้นรถ)`
          );

          if (soundEnabled) {
            speakFastSuccess(isDropOff ? 'สแกนลงรถเรียบร้อย' : 'สแกนขึ้นรถเรียบร้อย');
          }
          triggerVibration();

          try {
            confetti({
              particleCount: 30,
              spread: 60,
              origin: { y: 0.5 },
              colors: ['#38bdf8', '#34d399', '#fbbf24', '#f43f5e'],
            });
          } catch {
            // Ignore if blocked
          }
        } else if (res.isOfflineQueued) {
          setScans((prev) =>
            prev.map((s) =>
              s.id === newScan.id || s.scanId === newScan.scanId
                ? {
                    ...s,
                    firestoreDocId: res.docId || s.scanId,
                    dbSaved: false,
                    syncStatus: 'pending',
                    hasPendingWrites: true,
                    scanResult: 'รอซิงค์เซิร์ฟเวอร์',
                  }
                : s
            )
          );
          setActiveScan((curr) =>
            curr && (curr.id === newScan.id || curr.scanId === newScan.scanId)
              ? {
                  ...curr,
                  firestoreDocId: res.docId || curr.scanId,
                  dbSaved: false,
                  syncStatus: 'pending',
                  hasPendingWrites: true,
                  scanResult: 'รอซิงค์เซิร์ฟเวอร์',
                }
              : curr
          );
          showToast(`📡 คิวรอซิงค์ขึ้น Cloud: ${student.name} (บันทึกในเครื่องแล้ว)`);
          if (soundEnabled) {
            speakFastSuccess(isDropOff ? 'บันทึกคิวลงรถเรียบร้อย' : 'บันทึกคิวขึ้นรถเรียบร้อย');
          }
          triggerVibration();
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('Firestore scan insert failed:', err);
        notifySyncQueueChanged();
        setScans((prev) =>
          prev.map((s) =>
            s.id === newScan.id || s.scanId === newScan.scanId
              ? {
                  ...s,
                  dbSaved: false,
                  syncStatus: 'failed',
                  scanResult: 'บันทึกล้มเหลว',
                  syncError: errMsg,
                }
              : s
          )
        );
        setActiveScan((curr) =>
          curr && (curr.id === newScan.id || curr.scanId === newScan.scanId)
            ? {
                ...curr,
                dbSaved: false,
                syncStatus: 'failed',
                scanResult: 'บันทึกล้มเหลว',
                syncError: errMsg,
              }
            : curr
        );
        showToast(`❌ บันทึก Firebase ไม่สำเร็จ: กดลองซิงค์ใหม่ได้ในรายการ`);
      } finally {
        setIsSavingScan(false);
        releaseInFlightLocks();
      }

      // Background Google Sheets sync (secondary)
      if (autoSyncEnabled && isOnline) {
        syncToAppsScriptWebhook(appsScriptUrl, { ...newScan, scanResult: 'สำเร็จ' }).catch((err) => {
          console.warn('Background Apps Script sync failed:', err);
        });

        if (connectedSheetId) {
          getAccessToken()
            .then((token) => {
              if (token) {
                appendScansToSheet(connectedSheetId, [{ ...newScan, scanResult: 'สำเร็จ' }], token).catch((err) => {
                  console.warn('Background Google Sheet append failed:', err);
                });
              }
            })
            .catch(() => {});
        }
      }

      setTimeout(() => {
        setActiveScan((curr) => (curr?.id === newScan.id ? null : curr));
      }, 3500);
    },
    [cars, soundEnabled, autoSyncEnabled, appsScriptUrl, connectedSheetId, checkDuplicateForKeys, showToast, isOnline]
  );

  // Unified handler for Camera / Upload / Hardware USB-Bluetooth Barcode Scanner
  const handleScanSuccess = useCallback(
    async (data: {
      studentCode?: string;
      rawText: string;
      source: 'camera' | 'upload' | 'simulated' | 'barcode_scanner' | 'scanner';
      scanType?: 'ขึ้นรถ' | 'ลงรถ';
    }) => {
      const normalized = normalizeScannedPayload(data.rawText, studentsRef.current);
      let { student, rawKey } = resolveStudentFromQrText(normalized, studentsRef.current);

      // If not found in local React list, query Firestore `students` directly as authoritative source
      const existsInLocal = studentsRef.current.some(
        (s) => s.studentCode === student.studentCode || s.id === student.id
      );
      if (!existsInLocal && isFirebaseReady() && isOnline) {
        const firestoreStudent = await findStudentInFirestoreByCode(normalized);
        if (firestoreStudent) {
          student = firestoreStudent;
        }
      }

      await registerScan(student, data.source, data.scanType, rawKey);
    },
    [registerScan, isOnline]
  );

  // Handle Simulate Scan
  const handleSimulateScan = useCallback(() => {
    if (studentsRef.current.length === 0) {
      showToast('⚠️ กำลังซิงค์รายชื่อพนักงานจาก Firebase กรุณารอสักครู่หรือกดซิงค์ในเมนู Firebase');
      setIsFirebaseModalOpen(true);
      return;
    }
    const picked = studentsRef.current[Math.floor(Math.random() * studentsRef.current.length)];
    registerScan(picked, 'simulated');
  }, [registerScan, showToast]);

  const handleTestScanStudent = useCallback(
    (student: Student, scanType?: 'ขึ้นรถ' | 'ลงรถ') => {
      registerScan(student, 'simulated', scanType);
    },
    [registerScan]
  );

  const handleBatchTestScanAll = useCallback(async () => {
    const seen = new Set<string>();
    const batchList: Student[] = [];
    for (const s of studentsRef.current) {
      const k = (s.studentCode || s.id || '').trim().toUpperCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        batchList.push(s);
        if (batchList.length >= 20) break;
      }
    }
    for (let i = 0; i < batchList.length; i++) {
      const student = batchList[i];
      await registerScan(student, 'simulated');
      await new Promise((resolve) => setTimeout(resolve, 380));
    }
    showToast(`✓ ทดสอบสแกนบันทึกสำเร็จครบ ${batchList.length} รายชื่อ`);
  }, [registerScan, showToast]);

  // ==========================================
  // FIREBASE CRUD HANDLERS: STUDENTS (WITH ROLLBACK & CONFLICT DETECTION)
  // ==========================================
  const handleAddStudent = async (newStudent: Student) => {
    const previousStudents = studentsRef.current;
    setStudents((prev) => [newStudent, ...prev.filter((s) => s.id !== newStudent.id && s.studentCode !== newStudent.studentCode)]);
    if (isFirebaseReady() && isOnline) {
      try {
        const res = await upsertStudentToFirebase(newStudent);
        if (res.success) {
          removePendingStudent(newStudent.id || newStudent.studentCode);
          notifySyncQueueChanged();
          showToast(`🔥 บันทึก ${newStudent.name} ลง Firebase สำเร็จ`);
          return true;
        }
        if (res.conflict && res.data) {
          setStudents((prev) => prev.map((s) => (s.id === res.data!.id ? res.data! : s)));
          showToast(`⚠️ ${res.error}`);
          return false;
        }
        setStudents(previousStudents);
        showToast(`❌ บันทึก Firebase ไม่สำเร็จ: ${res.error || ''}`);
        return false;
      } catch (err) {
        setStudents(previousStudents);
        showToast(`❌ บันทึก Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
        return false;
      }
    } else {
      savePendingStudent(newStudent);
      notifySyncQueueChanged();
      showToast('💾 บันทึกพนักงานลงคิวเครื่องแล้ว — จะซิงค์ขึ้น Firebase อัตโนมัติเมื่อออนไลน์');
      return true;
    }
  };

  const handleEditStudent = async (updatedStudent: Student) => {
    const previousStudents = studentsRef.current;
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id || s.studentCode === updatedStudent.studentCode ? updatedStudent : s))
    );
    if (isFirebaseReady() && isOnline) {
      try {
        const res = await upsertStudentToFirebase(updatedStudent);
        if (res.success) {
          removePendingStudent(updatedStudent.id || updatedStudent.studentCode);
          notifySyncQueueChanged();
          showToast(`🔥 อัปเดต ${updatedStudent.name} ใน Firebase สำเร็จ`);
          return true;
        }
        if (res.conflict && res.data) {
          setStudents((prev) => prev.map((s) => (s.id === res.data!.id ? res.data! : s)));
          showToast(`⚠️ ${res.error}`);
          return false;
        }
        setStudents(previousStudents);
        showToast(`❌ อัปเดต Firebase ไม่สำเร็จ: ${res.error || ''}`);
        return false;
      } catch (err) {
        setStudents(previousStudents);
        showToast(`❌ อัปเดต Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
        return false;
      }
    } else {
      savePendingStudent(updatedStudent);
      notifySyncQueueChanged();
      showToast('💾 บันทึกการแก้ไขลงคิวเครื่องแล้ว — จะซิงค์ขึ้น Firebase อัตโนมัติเมื่อออนไลน์');
      return true;
    }
  };

  const handleDeleteStudent = async (id: string) => {
    const previousStudents = studentsRef.current;
    removePendingStudent(id);
    setStudents((prev) => prev.filter((s) => s.id !== id && s.studentCode !== id));
    if (isFirebaseReady()) {
      try {
        const res = await deleteStudentFromFirebase(id);
        if (res.success) {
          notifySyncQueueChanged();
          showToast('🔥 ลบพนักงานออกจาก Firebase สำเร็จ');
        } else {
          setStudents(previousStudents);
          showToast(`❌ ลบจาก Firebase ไม่สำเร็จ: ${res.error}`);
        }
      } catch (err) {
        setStudents(previousStudents);
        showToast(`❌ ลบจาก Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
      }
    }
  };

  const handleClearMockStudents = () => {
    setStudents(getPendingStudents());
    setCars(getPendingCars());
    setScans([]);
    showToast('รีเซ็ตแคชหน้าจอเรียบร้อย (กำลังซิงค์ข้อมูลสดจาก Firebase Firestore)');
    if (isFirebaseReady()) {
      void refreshFromFirebase(false);
    }
  };

  const handleImportStudents = async (importedStudents: Student[]) => {
    if (importedStudents.length === 0) return;
    const previousStudents = studentsRef.current;

    setStudents((prev) => {
      const existingMap = new Map<string, Student>();
      prev.forEach((s) => existingMap.set(s.studentCode.trim().toUpperCase(), s));
      importedStudents.forEach((s) => existingMap.set(s.studentCode.trim().toUpperCase(), s));
      return Array.from(existingMap.values());
    });

    if (isFirebaseReady() && isOnline) {
      try {
        const res = await importStudentsBatchToFirebase(importedStudents);
        showToast(`🔥 นำเข้า & บันทึกลง Firebase สำเร็จ ${res.count} คน`);
      } catch (err) {
        setStudents(previousStudents);
        showToast(`❌ นำเข้า Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
      }
    } else {
      importedStudents.forEach(savePendingStudent);
      notifySyncQueueChanged();
      showToast('💾 เก็บรายชื่อที่นำเข้าไว้ในคิวเครื่องแล้ว — จะซิงค์ขึ้น Firebase อัตโนมัติเมื่อออนไลน์');
    }
  };

  // ==========================================
  // FIREBASE CRUD HANDLERS: CARS (WITH ROLLBACK & CONFLICT DETECTION)
  // ==========================================
  const handleAddCar = async (newCar: Car) => {
    const previousCars = carsRef.current;
    setCars((prev) => [...prev.filter((c) => c.carID !== newCar.carID), newCar]);
    if (isFirebaseReady() && isOnline) {
      try {
        const res = await upsertCarToFirebase(newCar);
        if (res.success) {
          removePendingCar(newCar.carID);
          notifySyncQueueChanged();
          showToast(`🔥 บันทึกรถ ${newCar.name} ลง Firebase สำเร็จ`);
          return true;
        }
        if (res.conflict && res.data) {
          setCars((prev) => prev.map((c) => (c.carID === res.data!.carID ? res.data! : c)));
          showToast(`⚠️ ${res.error}`);
          return false;
        }
        setCars(previousCars);
        showToast(`❌ บันทึกรถไม่สำเร็จ: ${res.error || ''}`);
        return false;
      } catch (err) {
        setCars(previousCars);
        showToast(`❌ บันทึกรถลง Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
        return false;
      }
    } else {
      savePendingCar(newCar);
      notifySyncQueueChanged();
      showToast('💾 บันทึกรถลงคิวเครื่องแล้ว — จะซิงค์ขึ้น Firebase อัตโนมัติเมื่อออนไลน์');
      return true;
    }
  };

  const handleEditCar = async (updatedCar: Car) => {
    const previousCars = carsRef.current;
    setCars((prev) => prev.map((c) => (c.carID === updatedCar.carID ? updatedCar : c)));
    if (isFirebaseReady() && isOnline) {
      try {
        const res = await upsertCarToFirebase(updatedCar);
        if (res.success) {
          removePendingCar(updatedCar.carID);
          notifySyncQueueChanged();
          showToast(`🔥 อัปเดตรถ ${updatedCar.name} ใน Firebase สำเร็จ`);
          return true;
        }
        if (res.conflict && res.data) {
          setCars((prev) => prev.map((c) => (c.carID === res.data!.carID ? res.data! : c)));
          showToast(`⚠️ ${res.error}`);
          return false;
        }
        setCars(previousCars);
        showToast(`❌ อัปเดตรถไม่สำเร็จ: ${res.error || ''}`);
        return false;
      } catch (err) {
        setCars(previousCars);
        showToast(`❌ อัปเดตรถลง Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
        return false;
      }
    } else {
      savePendingCar(updatedCar);
      notifySyncQueueChanged();
      showToast('💾 บันทึกการแก้ไขรถลงคิวเครื่องแล้ว — จะซิงค์ขึ้น Firebase อัตโนมัติเมื่อออนไลน์');
      return true;
    }
  };

  const handleDeleteCar = async (carId: string) => {
    const previousCars = carsRef.current;
    removePendingCar(carId);
    setCars((prev) => prev.filter((c) => c.carID !== carId));
    if (isFirebaseReady()) {
      try {
        const res = await deleteCarFromFirebase(carId);
        if (res.success) {
          notifySyncQueueChanged();
          showToast('🔥 ลบรถออกจาก Firebase สำเร็จ');
        } else {
          setCars(previousCars);
          showToast(`❌ ลบรถไม่สำเร็จ: ${res.error}`);
        }
      } catch (err) {
        setCars(previousCars);
        showToast(`❌ ลบรถจาก Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
      }
    }
  };

  // ==========================================
  // FIREBASE CRUD HANDLERS: SCANS
  // ==========================================
  const handleDeleteScan = async (scanId: string, firestoreDocId?: string) => {
    const previousScans = scansRef.current;
    removePendingScan(scanId);
    setScans((prev) =>
      prev.filter(
        (s) =>
          s.id !== scanId &&
          s.scanId !== scanId &&
          (!firestoreDocId || s.firestoreDocId !== firestoreDocId)
      )
    );
    if (isFirebaseReady()) {
      try {
        const res = await deleteScanFromFirebase(scanId, firestoreDocId);
        if (res.success) {
          notifySyncQueueChanged();
          showToast('🔥 ลบรายการสแกนจาก Firebase แล้ว');
        } else {
          setScans(previousScans);
          showToast(`❌ ลบรายการสแกนไม่สำเร็จ: ${res.error}`);
        }
      } catch (err) {
        setScans(previousScans);
        showToast(`❌ ลบจาก Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
      }
    }
  };

  const handleLoadMoreScans = useCallback(() => {
    setIsLoadingMoreScans(true);
    setScansLimit((prev) => Math.min(10000, prev + 50));
  }, []);

  const handleRetryScan = useCallback(
    async (scan: ScanRecord) => {
      if (!isFirebaseReady()) {
        showToast('⚠️ Firebase ยังไม่พร้อมใช้งาน');
        return;
      }
      if (!isOnline) {
        showToast('🟠 ยังอยู่ในโหมดออฟไลน์ — ระบบจะซิงค์ให้อัตโนมัติเมื่อกลับมาออนไลน์');
        return;
      }

      setScans((prev) =>
        prev.map((s) =>
          s.scanId === scan.scanId || s.id === scan.id
            ? { ...s, syncStatus: 'pending', scanResult: 'กำลังซิงค์', syncError: undefined }
            : s
        )
      );

      try {
        const res = await insertScanToFirebase(
          { ...scan, scanResult: 'สำเร็จ' },
          {
            isNewScan: false,
            skipStudentUpsert: true,
            checkDuplicateBeforeAdd: true,
          }
        );
        if (res.success) {
          removePendingScan(scan.scanId || scan.id);
          setScans((prev) =>
            prev.map((s) =>
              s.scanId === scan.scanId || s.id === scan.id
                ? {
                    ...s,
                    firestoreDocId: res.docId || s.firestoreDocId,
                    dbSaved: true,
                    syncStatus: 'synced',
                    scanResult: 'สำเร็จ',
                    syncError: undefined,
                  }
                : s
            )
          );
          setSelectedScanDetail((curr) =>
            curr && (curr.scanId === scan.scanId || curr.id === scan.id)
              ? {
                  ...curr,
                  firestoreDocId: res.docId || curr.firestoreDocId,
                  dbSaved: true,
                  syncStatus: 'synced',
                  scanResult: 'สำเร็จ',
                  syncError: undefined,
                }
              : curr
          );
          showToast(`✓ ซิงค์รายการ ${scan.name} ขึ้น Firebase สำเร็จ`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setScans((prev) =>
          prev.map((s) =>
            s.scanId === scan.scanId || s.id === scan.id
              ? { ...s, dbSaved: false, syncStatus: 'failed', scanResult: 'บันทึกล้มเหลว', syncError: msg }
              : s
          )
        );
        showToast('❌ ซิงค์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
    },
    [isOnline, showToast]
  );

  const handleSyncPendingNow = useCallback(async () => {
    if (!isFirebaseReady() || !isOnline) {
      showToast('🟠 กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนซิงค์รายการที่ค้าง');
      return;
    }
    const [carRes, stuRes, scanRes] = await Promise.all([
      syncPendingCars(),
      syncPendingStudents(),
      syncPendingScans(),
    ]);
    notifySyncQueueChanged();
    const total = carRes.syncedCount + stuRes.syncedCount + scanRes.syncedCount;
    if (total > 0) {
      showToast(`✓ ซิงค์ข้อมูลที่ค้างสำเร็จ ${total} รายการ`);
    } else {
      showToast('✓ ข้อมูลทั้งหมดซิงค์กับ Firebase แล้ว');
    }
  }, [isOnline, showToast]);

  const handleClearAllScans = async () => {
    const previousScans = scansRef.current;
    clearPendingScans();
    setScans([]);
    setActiveScan(null);
    if (isFirebaseReady()) {
      try {
        const res = await clearAllScansInFirebase();
        if (res.success) {
          notifySyncQueueChanged();
          showToast('🔥 ล้างประวัติสแกนใน Firebase ทั้งหมดแล้ว');
        } else {
          setScans(previousScans);
          showToast(`❌ ล้างประวัติสแกนไม่สำเร็จ: ${res.error || ''}`);
        }
      } catch (err) {
        setScans(previousScans);
        showToast(`❌ ล้างประวัติสแกน Firebase ไม่สำเร็จ (คืนค่าเดิมแล้ว): ${err instanceof Error ? err.message : ''}`);
      }
    }
  };

  // ==========================================
  // FIREBASE CRUD HANDLERS: USERS & SETTINGS (WITH ROLLBACK)
  // ==========================================
  const handleUpsertUser = async (appUser: AppUser) => {
    const previousUsers = usersRef.current;
    setUsers((prev) => [
      ...prev.filter((u) => u.user_id !== appUser.user_id),
      appUser,
    ].sort((a, b) => a.user_id.localeCompare(b.user_id)));
    try {
      await upsertUserToFirebase(appUser);
      showToast(`🔥 บันทึกบัญชีผู้ใช้ ${appUser.name} ลง Firebase สำเร็จ`);
    } catch (err) {
      setUsers(previousUsers);
      showToast(`❌ บันทึกผู้ใช้ไม่สำเร็จ: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const previousUsers = usersRef.current;
    setUsers((prev) => prev.filter((u) => u.user_id !== userId));
    try {
      await deleteUserFromFirebase(userId);
      showToast('🔥 ลบบัญชีผู้ใช้จาก Firebase แล้ว');
    } catch (err) {
      setUsers(previousUsers);
      showToast(`❌ ลบผู้ใช้ไม่สำเร็จ: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleUpsertSetting = async (setting: SystemSetting) => {
    const previousSettings = settingsRef.current;
    setSettings((prev) => [
      ...prev.filter((s) => s.key !== setting.key),
      setting,
    ].sort((a, b) => a.key.localeCompare(b.key)));
    try {
      await upsertSettingToFirebase(setting);
      showToast(`🔥 บันทึกการตั้งค่า ${setting.key} ลง Firebase สำเร็จ`);
    } catch (err) {
      setSettings(previousSettings);
      showToast(`❌ บันทึกการตั้งค่าไม่สำเร็จ: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleDeleteSetting = async (key: string) => {
    const previousSettings = settingsRef.current;
    setSettings((prev) => prev.filter((s) => s.key !== key));
    try {
      await deleteSettingFromFirebase(key);
      showToast('🔥 ลบการตั้งค่าจาก Firebase แล้ว');
    } catch (err) {
      setSettings(previousSettings);
      showToast(`❌ ลบการตั้งค่าไม่สำเร็จ: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const firebaseReady = isFirebaseReady() && isFirebaseConnected;

  return (
    <>
      {/* ============ SPLASH ============ */}
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}

      {/* ============ MAIN APP ============ */}
      <div id="app" className={`app ${showSplash ? 'hidden' : ''}`}>
        {/* iOS Status Bar Mock */}
        <div className="statusbar-mock">
          <span id="statusTime">{currentTime}</span>
          <div className="status-right">
            <span>
              {syncSnapshot.status === 'offline'
                ? '🟠'
                : syncSnapshot.status === 'error'
                ? '🔴'
                : syncSnapshot.status === 'pending' || syncSnapshot.status === 'syncing'
                ? '🔵'
                : '🟢'}
            </span>
            <span>📶</span>
            <span>🔋</span>
          </div>
        </div>

        {/* ============ SCAN SCREEN (HOME) ============ */}
        <section
          id="screen-scan"
          className={`screen ${!isAdminDashboardOpen ? 'active' : ''}`}
        >
          {/* Top : Camera / Hardware Barcode Scanner */}
          <CameraHalf
            onScanSuccess={handleScanSuccess}
            checkDuplicateBeforeScan={checkDuplicateBeforeCameraScan}
            onSimulateScan={handleSimulateScan}
            onOpenTestScanModal={() => setIsTestScanModalOpen(true)}
            activeScan={activeScan}
            totalScans={scans.length}
            onCameraActiveChange={setIsCameraActive}
            isOnline={isOnline}
            isSavingScan={isSavingScan}
            suspendHardwareScanner={
              isAdminDashboardOpen ||
              isAdminLoginOpen ||
              isFirebaseModalOpen ||
              isTestScanModalOpen ||
              Boolean(selectedScanDetail)
            }
          />

          {/* Bottom : Scan List (Bottom Sheet with Auto-Collapse) */}
          <ScanListHalf
            scans={scans}
            cars={cars}
            students={students}
            cameraActive={isCameraActive}
            isOnline={isOnline}
            isFirebaseConnected={firebaseReady}
            syncSnapshot={syncSnapshot}
            hasMoreScans={hasMoreScans}
            isLoadingMoreScans={isLoadingMoreScans}
            latestHighlightedScanId={latestRemoteScanId}
            onLoadMoreScans={handleLoadMoreScans}
            onRetryScan={handleRetryScan}
            onSyncPending={handleSyncPendingNow}
            onSelectScan={(scan) => setSelectedScanDetail(scan)}
            onClearAll={handleClearAllScans}
            onOpenAdmin={() => setIsAdminLoginOpen(true)}
            onOpenMap={() => {
              setAdminInitialTab('routes');
              setIsAdminDashboardOpen(true);
            }}
            soundEnabled={soundEnabled}
            onToggleSound={() => {
              setSoundEnabled((prev) => {
                const next = !prev;
                showToast(next ? 'เปิดเสียงประกาศภาษาไทย' : 'ปิดเสียงประกาศ');
                return next;
              });
            }}
          />
        </section>

        {/* ============ ADMIN SCREEN (FULL CRUD FIREBASE) ============ */}
        {isAdminDashboardOpen && (
          <AdminDashboard
            initialTab={adminInitialTab}
            students={students}
            cars={cars}
            scans={scans}
            users={users}
            settings={settings}
            syncSnapshot={syncSnapshot}
            onAddStudent={handleAddStudent}
            onEditStudent={handleEditStudent}
            onDeleteStudent={handleDeleteStudent}
            onImportStudents={handleImportStudents}
            onAddCar={handleAddCar}
            onEditCar={handleEditCar}
            onDeleteCar={handleDeleteCar}
            onDeleteScan={handleDeleteScan}
            onClearAllScans={handleClearAllScans}
            onUpsertUser={handleUpsertUser}
            onDeleteUser={handleDeleteUser}
            onUpsertSetting={handleUpsertSetting}
            onDeleteSetting={handleDeleteSetting}
            onCloseAdmin={() => {
              setIsAdminDashboardOpen(false);
              void setDeviceSessionRole('Staff');
            }}
            appsScriptUrl={appsScriptUrl}
            onUpdateAppsScriptUrl={setAppsScriptUrl}
            connectedSheetId={connectedSheetId}
            onUpdateConnectedSheetId={handleUpdateConnectedSheetId}
            connectedSheetTitle={connectedSheetTitle}
            connectedSheetUrl={connectedSheetUrl}
            autoSyncEnabled={autoSyncEnabled}
            onToggleAutoSync={() => setAutoSyncEnabled((prev) => !prev)}
            onSyncFromGoogleSheets={() => refreshFromGoogleSheets(false)}
            isSyncingSheets={isSyncingSheets}
            onSyncFromFirebase={() => refreshFromFirebase(false)}
            isSyncingFirebase={isSyncingFirebase}
            onClearMockStudents={handleClearMockStudents}
            onOpenFirebaseAuth={() => setIsFirebaseModalOpen(true)}
          />
        )}
      </div>

      {/* ============ FIREBASE CLOUD SYNC MODAL ============ */}
      <FirebaseAuthModal
        isOpen={isFirebaseModalOpen}
        onClose={() => setIsFirebaseModalOpen(false)}
        studentCount={students.length}
        carCount={cars.length}
        scanCount={scans.length}
        syncSnapshot={syncSnapshot}
        onSyncComplete={() => refreshFromFirebase(true)}
        onOpenFullFirebaseTab={() => {
          setAdminInitialTab('firebase');
          setIsAdminDashboardOpen(true);
        }}
      />

      {/* ============ TEST SCAN MODAL (ALL STUDENTS & CUSTOM NAMES) ============ */}
      <TestScanModal
        isOpen={isTestScanModalOpen}
        onClose={() => setIsTestScanModalOpen(false)}
        students={students}
        cars={cars}
        onTestScanStudent={handleTestScanStudent}
        onBatchTestScanAll={handleBatchTestScanAll}
        isFirebaseReady={firebaseReady}
        onOpenFirebaseConfig={() => setIsFirebaseModalOpen(true)}
      />

      {/* ============ LOGIN SHEET ============ */}
      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
        onSuccess={() => {
          setIsAdminLoginOpen(false);
          setIsAdminDashboardOpen(true);
          void setDeviceSessionRole('Admin');
          showToast('เข้าสู่ระบบแอดมินสำเร็จ');
        }}
      />

      {/* ============ RESULT DETAIL SHEET & MAP MODAL ============ */}
      <CardDetailModal
        scan={selectedScanDetail}
        studentDetails={
          selectedScanDetail
            ? students.find((s) => s.studentCode === selectedScanDetail.studentCode || s.id === selectedScanDetail.studentId)
            : undefined
        }
        onRetryScan={handleRetryScan}
        onClose={() => setSelectedScanDetail(null)}
      />

      {/* ============ TOAST / NOTIFICATION ============ */}
      <div id="toast" className={`toast ${toastMsg ? 'show' : ''}`}>
        {toastMsg}
      </div>

      <iframe id="printFrame" style={{ display: 'none' }} title="Print Frame" />
    </>
  );
}
