import React, { useState, useEffect } from 'react';
import {
  Database,
  CheckCircle2,
  AlertCircle,
  X,
  Zap,
  RefreshCw,
  ShieldCheck,
  ArrowRight,
  UploadCloud,
  Wifi,
} from 'lucide-react';
import { RealtimeSyncSnapshot } from '../types';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  isFirebaseReady,
  getDeviceOperatorId,
  testConnection,
  getPendingScans,
  getPendingCars,
  getPendingStudents,
  syncPendingScans,
  syncPendingCars,
  syncPendingStudents,
  seedAllInitialDataToFirebase,
  MigrationProgress,
} from '../services/firebaseClient';

interface FirebaseAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentCount: number;
  carCount: number;
  scanCount: number;
  syncSnapshot?: RealtimeSyncSnapshot;
  onSyncComplete?: () => Promise<void> | void;
  onOpenFullFirebaseTab?: () => void;
}

export const FirebaseAuthModal: React.FC<FirebaseAuthModalProps> = ({
  isOpen,
  onClose,
  studentCount,
  carCount,
  scanCount,
  syncSnapshot,
  onSyncComplete,
  onOpenFullFirebaseTab,
}) => {
  const [isTesting, setIsTesting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isSyncingPending, setIsSyncingPending] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setPendingCount(
        getPendingScans().length + getPendingCars().length + getPendingStudents().length
      );
      setStatusMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isConnected = isFirebaseReady();
  const deviceId = getDeviceOperatorId();

  const handleTestAndRefresh = async () => {
    setIsTesting(true);
    setStatusMessage(null);
    try {
      const conn = await testConnection();
      if (onSyncComplete) {
        await onSyncComplete();
      }
      setStatusMessage({
        type: conn.online ? 'success' : 'error',
        text: conn.online
          ? `ซิงค์ข้อมูลล่าสุดจาก Firebase เรียบร้อย (${deviceId})`
          : conn.message,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        type: 'error',
        text: `ตรวจสอบการเชื่อมต่อไม่สำเร็จ: ${msg}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSeedAll = async () => {
    if (!isConnected || isMigrating) return;
    setIsMigrating(true);
    setStatusMessage(null);
    try {
      const res = await seedAllInitialDataToFirebase({
        includeSampleScans: false,
        onProgress: (p) => setMigrationProgress(p),
      });
      setStatusMessage({
        type: 'success',
        text: `ซิงค์ข้อมูลเข้า Firebase สำเร็จ! พนักงาน ${res.studentsCount} คน, รถ ${res.carsCount} คัน, ผู้ใช้ ${res.usersCount} คน, ตั้งค่า ${res.settingsCount} รายการ`,
      });
      if (onSyncComplete) {
        await onSyncComplete();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        type: 'error',
        text: `ย้ายข้อมูลไม่สำเร็จ: ${msg}`,
      });
    } finally {
      setIsMigrating(false);
      setMigrationProgress(null);
    }
  };

  const handleSyncPending = async () => {
    if (!isConnected || isSyncingPending) return;
    setIsSyncingPending(true);
    try {
      const carRes = await syncPendingCars();
      const stuRes = await syncPendingStudents();
      const scanRes = await syncPendingScans();
      setPendingCount(
        getPendingScans().length + getPendingCars().length + getPendingStudents().length
      );
      const totalSynced = carRes.syncedCount + stuRes.syncedCount + scanRes.syncedCount;
      if (totalSynced > 0) {
        setStatusMessage({
          type: 'success',
          text: `ซิงค์ข้อมูลค้างส่งขึ้น Firebase สำเร็จ (รถ ${carRes.syncedCount}, พนักงาน ${stuRes.syncedCount}, สแกน ${scanRes.syncedCount})`,
        });
      }
      if (onSyncComplete) {
        await onSyncComplete();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsSyncingPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      id="firebaseAuthModal"
    >
      <div className="bg-slate-900 border border-amber-500/30 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-slate-900 px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Database className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>สถานะ Firebase Cloud Sync</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Real-time ทุกเครื่อง
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Project: <span className="font-mono text-amber-300">{FIREBASE_PROJECT_ID}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Status Banner */}
          <div
            className={`p-3.5 rounded-2xl border flex items-start gap-3 ${
              isConnected
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
            }`}
          >
            {isConnected ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white flex flex-wrap items-center gap-2">
                <span>
                  {!isConnected
                    ? 'กำลังเตรียมการเชื่อมต่อ Firebase Firestore'
                    : syncSnapshot?.status === 'offline'
                    ? 'โหมดออฟไลน์ — พร้อมซิงค์อัตโนมัติเมื่อออนไลน์'
                    : syncSnapshot?.status === 'error'
                    ? 'การเชื่อมต่อ Firestore ขัดข้อง'
                    : syncSnapshot?.status === 'syncing'
                    ? 'กำลังซิงค์ข้อมูลแบบ Real-time...'
                    : 'เชื่อมต่อ Firebase Firestore อัตโนมัติ 100%'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                  {syncSnapshot?.fromCache ? 'แคชในเครื่อง' : 'Server Live'}
                </span>
              </div>
              <div className="text-[11px] opacity-90 mt-1 truncate">
                เครื่องนี้: <span className="font-mono text-amber-300">{deviceId}</span> · บทบาท:{' '}
                <span className="font-mono text-cyan-300">{syncSnapshot?.deviceRole || 'Staff'}</span> · DB:{' '}
                {FIRESTORE_DATABASE_ID.slice(0, 14)}...
              </div>
              <div className="text-[11px] text-emerald-300/90 mt-0.5">
                {syncSnapshot?.lastSyncedAt
                  ? `ซิงค์ล่าสุด: ${new Date(syncSnapshot.lastSyncedAt).toLocaleTimeString('th-TH', { hour12: false })} (Listeners: ${syncSnapshot.activeListeners})`
                  : 'เห็นรายการสแกนจากทุกเครื่องแบบ Real-time ทันทีที่เปิดแอป'}
              </div>

              {isConnected && (
                <div className="mt-2.5 flex flex-wrap items-center gap-3 pt-2 border-t border-emerald-500/20 text-[11px]">
                  <span className="text-slate-300">
                    พนักงาน: <strong className="text-emerald-300 font-mono">{studentCount}</strong> คน
                  </span>
                  <span className="text-slate-300">
                    รถ: <strong className="text-emerald-300 font-mono">{carCount}</strong> คัน
                  </span>
                  <span className="text-slate-300">
                    บันทึกสแกน: <strong className="text-emerald-300 font-mono">{scanCount}</strong> รายการ
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Pending offline scans notice */}
          {pendingCount > 0 && (
            <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-2xl flex items-center justify-between gap-3 text-purple-200">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-400 shrink-0" />
                <span>
                  มีรายการรอส่งขึ้น Firebase อยู่{' '}
                  <strong className="text-white font-mono">{pendingCount}</strong> รายการ
                </span>
              </div>
              <button
                type="button"
                disabled={isSyncingPending || !isConnected}
                onClick={handleSyncPending}
                className="px-3 py-1 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center gap-1 shrink-0 text-[11px]"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncingPending ? 'animate-spin' : ''}`} />
                <span>{isSyncingPending ? 'กำลังส่ง...' : 'ส่งขึ้นทันที'}</span>
              </button>
            </div>
          )}

          {/* Feedback message */}
          {statusMessage && (
            <div
              className={`p-3 rounded-2xl border text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-500/30 text-rose-300'
              }`}
            >
              {statusMessage.text}
            </div>
          )}

          {/* Migration progress */}
          {migrationProgress && (
            <div className="bg-slate-800/80 p-3.5 rounded-2xl border border-amber-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-amber-300 font-semibold">{migrationProgress.step}</span>
                <span className="font-mono text-white">
                  {migrationProgress.completed}/{migrationProgress.total}
                </span>
              </div>
              <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-amber-400 h-full transition-all duration-300"
                  style={{
                    width: `${
                      migrationProgress.total > 0
                        ? Math.round((migrationProgress.completed / migrationProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Primary Actions */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleTestAndRefresh}
              disabled={isTesting || !isConnected}
              className="w-full py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs flex items-center justify-center gap-2 border border-amber-500/30 transition-all active:scale-[0.99] disabled:opacity-60"
            >
              {isTesting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              <span>{isTesting ? 'กำลังดึงข้อมูลล่าสุด...' : 'ดึงข้อมูลสดจาก Firebase ทุกเครื่องทันที'}</span>
            </button>

            <button
              type="button"
              onClick={handleSeedAll}
              disabled={isMigrating || !isConnected}
              className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition-all active:scale-[0.99] disabled:opacity-60"
            >
              {isMigrating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
              <span>
                {isMigrating
                  ? 'กำลังย้ายข้อมูลเข้า Firebase...'
                  : 'ซิงค์ / ย้ายข้อมูลทั้งหมด 300 คน + รถ + ผู้ใช้ + ตั้งค่า เข้า Firebase'}
              </span>
            </button>

            {onOpenFullFirebaseTab && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullFirebaseTab();
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 border border-white/10"
              >
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span>จัดการฐานข้อมูล Firebase ทั้งหมด</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
