import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  LogIn,
  LogOut,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wifi,
  WifiOff,
  Smartphone,
  UserCheck,
  ScanBarcode,
  Camera,
} from 'lucide-react';
import { ScanRecord, Car, Student } from '../types';
import { DailySummaryModal } from './DailySummaryModal';

const AUTO_COLLAPSE_DELAY_MS = 5000;

interface ScanListHalfProps {
  scans: ScanRecord[];
  onSelectScan: (scan: ScanRecord) => void;
  onClearAll: () => void;
  onOpenAdmin: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  cars?: Car[];
  students?: Student[];
  onOpenDailyReport?: () => void;
  onOpenMap?: () => void;
  cameraActive?: boolean;
  isOnline?: boolean;
  isFirebaseConnected?: boolean;
  hasMoreScans?: boolean;
  isLoadingMoreScans?: boolean;
  onLoadMoreScans?: () => void;
  onRetryScan?: (scan: ScanRecord) => void;
  onSyncPending?: () => void;
}

export const ScanListHalf: React.FC<ScanListHalfProps> = ({
  scans,
  onSelectScan,
  onClearAll,
  onOpenAdmin,
  soundEnabled,
  onToggleSound,
  cars = [],
  students = [],
  onOpenDailyReport,
  onOpenMap,
  cameraActive = false,
  isOnline = true,
  isFirebaseConnected = true,
  hasMoreScans = false,
  isLoadingMoreScans = false,
  onLoadMoreScans,
  onRetryScan,
  onSyncPending,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [showDailyReport, setShowDailyReport] = useState(false);
  const [activityTick, setActivityTick] = useState(0);

  const touchStartYRef = useRef<number | null>(null);
  const prevScanCountRef = useRef<number>(scans.length);

  const bumpActivity = useCallback(() => {
    setActivityTick((t) => t + 1);
  }, []);

  // Auto-collapse when camera starts scanning
  useEffect(() => {
    if (cameraActive) {
      setIsCollapsed(true);
      setSearchOpen(false);
    }
  }, [cameraActive]);

  // Reset idle countdown when a new scan arrives while expanded
  useEffect(() => {
    if (scans.length > prevScanCountRef.current && !isCollapsed) {
      bumpActivity();
    }
    prevScanCountRef.current = scans.length;
  }, [scans.length, isCollapsed, bumpActivity]);

  // Auto-collapse after inactivity when expanded and not searching or viewing modals
  useEffect(() => {
    if (isCollapsed || searchOpen || showConfirmClear || showDailyReport) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsCollapsed(true);
    }, AUTO_COLLAPSE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isCollapsed, searchOpen, showConfirmClear, showDailyReport, activityTick]);

  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      if (next) {
        setSearchOpen(false);
      } else {
        bumpActivity();
      }
      return next;
    });
  };

  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleHeaderTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current == null) return;
    const endY = e.changedTouches[0]?.clientY ?? touchStartYRef.current;
    const deltaY = endY - touchStartYRef.current;
    touchStartYRef.current = null;

    if (deltaY > 28) {
      setIsCollapsed(true);
      setSearchOpen(false);
    } else if (deltaY < -28) {
      setIsCollapsed(false);
      bumpActivity();
    }
  };

  // Sync counters
  const { pendingCount, failedCount } = useMemo(() => {
    let pending = 0;
    let failed = 0;
    scans.forEach((s) => {
      if (s.syncStatus === 'failed') failed++;
      else if (s.syncStatus === 'pending' || (!s.syncStatus && !s.dbSaved)) pending++;
    });
    return { pendingCount: pending, failedCount: failed };
  }, [scans]);

  // Filtered scans
  const filteredScans = useMemo(() => {
    if (!searchQuery.trim()) return scans;
    const q = searchQuery.toLowerCase().trim();
    return scans.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.studentCode.toLowerCase().includes(q) ||
        (s.grade && s.grade.toLowerCase().includes(q)) ||
        (s.room && s.room.toLowerCase().includes(q)) ||
        (s.locationName && s.locationName.toLowerCase().includes(q)) ||
        (s.busNumber && s.busNumber.toLowerCase().includes(q)) ||
        (s.carID && s.carID.toLowerCase().includes(q)) ||
        (s.plate && s.plate.toLowerCase().includes(q)) ||
        (s.scannerName && s.scannerName.toLowerCase().includes(q)) ||
        (s.device && s.device.toLowerCase().includes(q)) ||
        (s.scanId && s.scanId.toLowerCase().includes(q)) ||
        (s.scanType && s.scanType.toLowerCase().includes(q)) ||
        (s.scanResult && s.scanResult.toLowerCase().includes(q))
    );
  }, [scans, searchQuery]);

  const handleClearClick = () => {
    if (scans.length === 0) return;
    setShowConfirmClear(true);
  };

  const confirmClear = () => {
    onClearAll();
    setShowConfirmClear(false);
  };

  return (
    <div
      className={`list-half ${isCollapsed ? 'collapsed' : ''}`}
      onPointerDown={bumpActivity}
      onWheel={bumpActivity}
    >
      {/* iOS Sheet Grabber */}
      <div
        className="sheet-grabber"
        onClick={handleToggleCollapse}
        onTouchStart={handleHeaderTouchStart}
        onTouchEnd={handleHeaderTouchEnd}
        title={isCollapsed ? 'แตะเพื่อกางรายการสแกนวันนี้' : 'แตะเพื่อพับรายการลง'}
      ></div>

      {/* List Header */}
      <div
        className="list-header"
        onTouchStart={handleHeaderTouchStart}
        onTouchEnd={handleHeaderTouchEnd}
      >
        <div
          className="lh-left min-w-0 flex-1 pr-2 cursor-pointer select-none"
          onClick={handleToggleCollapse}
          title={isCollapsed ? 'แตะเพื่อเปิดดูรายการสแกนวันนี้' : 'แตะเพื่อพับรายการลง (พับอัตโนมัติใน 5 วินาที)'}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3>รายการสแกนวันนี้</h3>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${
                isOnline && isFirebaseConnected
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : isOnline
                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}
              title={
                isOnline && isFirebaseConnected
                  ? 'ออนไลน์ · เชื่อมต่อ Firebase Real-time แล้ว'
                  : isOnline
                  ? 'ออนไลน์ · กำลังเชื่อมต่อเซิร์ฟเวอร์'
                  : 'ออฟไลน์ · ข้อมูลจะคิวไว้ในเครื่องแล้วซิงค์อัตโนมัติเมื่อออนไลน์'
              }
            >
              {isOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              <span>{isOnline ? (isFirebaseConnected ? 'ออนไลน์ · Live' : 'กำลังเชื่อม') : 'ออฟไลน์'}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className="lh-count shrink-0" id="scanCount">
              {scans.length} รายการ
            </span>
            {(pendingCount > 0 || failedCount > 0) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSyncPending?.();
                }}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                title="กดเพื่อซิงค์รายการที่ค้างขึ้น Firebase ทันที"
              >
                {failedCount > 0 ? `⚠️ ล้มเหลว ${failedCount}` : `⏳ รอซิงค์ ${pendingCount}`} · ซิงค์
              </button>
            )}
            {isCollapsed && scans[0] && (
              <span className="text-[11px] text-slate-400 truncate">
                · ล่าสุด: {scans[0].name}
              </span>
            )}
          </div>
        </div>
        <div className="lh-right shrink-0">
          <button
            className={`icon-circle ${searchOpen && !isCollapsed ? 'border-amber-500/50 text-amber-400' : ''}`}
            id="btnSearch"
            type="button"
            onClick={() => {
              bumpActivity();
              if (isCollapsed) {
                setIsCollapsed(false);
                setSearchOpen(true);
              } else {
                setSearchOpen((prev) => !prev);
              }
            }}
            title="ค้นหา"
          >
            🔎
          </button>
          <button
            className="icon-circle report"
            id="btnDailyReport"
            type="button"
            onClick={() => {
              bumpActivity();
              if (onOpenDailyReport) onOpenDailyReport();
              setShowDailyReport(true);
            }}
            title="รายงานสรุปประจำวัน (ยอดขึ้นรถ/ลงรถ)"
          >
            📊
          </button>
          {onOpenMap && (
            <button
              className="icon-circle map"
              id="btnRouteMap"
              type="button"
              onClick={() => {
                bumpActivity();
                onOpenMap();
              }}
              title="แผนที่เส้นทางรถและพิกัดสแกนจุดรับส่ง"
            >
              🗺️
            </button>
          )}
          <button
            className="icon-circle"
            id="btnClear"
            type="button"
            onClick={() => {
              bumpActivity();
              handleClearClick();
            }}
            title="ล้างรายการ"
          >
            🗑️
          </button>
          <button
            className="icon-circle admin"
            type="button"
            onClick={() => {
              bumpActivity();
              onOpenAdmin();
            }}
            title="จัดการระบบ"
          >
            ⚙️
          </button>
          <button
            className="icon-circle"
            id="btnToggleScanList"
            type="button"
            onClick={handleToggleCollapse}
            title={isCollapsed ? 'ขยายรายการสแกน' : 'พับรายการลง'}
          >
            {isCollapsed ? (
              <ChevronUp className="w-4 h-4 text-emerald-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-300" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Search Bar */}
      <div className={`search-bar ${searchOpen && !isCollapsed ? '' : 'hidden'}`} id="searchBar">
        <input
          id="scanSearch"
          className="search-input"
          placeholder="ค้นหา ชื่อ / รหัส / ชั้น-แผนก / ห้อง / รถ / ทะเบียน / อุปกรณ์ / ผู้สแกน"
          value={searchQuery}
          onChange={(e) => {
            bumpActivity();
            setSearchQuery(e.target.value);
          }}
          autoFocus={searchOpen && !isCollapsed}
        />
      </div>

      {/* Scan List */}
      <div className="scan-list" id="scanList" onScroll={bumpActivity}>
        {filteredScans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-slate-800/80 flex items-center justify-center text-2xl border border-white/5">
              🚌
            </div>
            <p className="text-sm font-medium text-slate-300">
              {searchQuery ? 'ไม่พบข้อมูลที่ตรงกับคำค้นหา' : 'ยังไม่มีประวัติการสแกนในระบบ Firebase'}
            </p>
            <p className="text-xs text-slate-500">
              {searchQuery ? 'ลองพิมพ์คำค้นอื่น' : 'สแกนผ่านกล้อง QR หรือเครื่องยิงบาร์โค้ดเพื่อเริ่มต้น'}
            </p>
          </div>
        ) : (
          <>
            {filteredScans.map((scan, index) => {
              const isDropOff =
                scan.scanType === 'ลงรถ' || (scan.scanType && scan.scanType.includes('ลง'));
              const statusLabel = isDropOff ? 'ลงรถ แล้ว' : 'ขึ้นรถ';
              const syncState: 'pending' | 'synced' | 'failed' =
                scan.syncStatus || (scan.dbSaved ? 'synced' : 'pending');
              const isBarcodeGun =
                scan.scanSource === 'barcode_scanner' || scan.scanSource === 'scanner';
              const scanSourceLabel = isBarcodeGun
                ? 'เครื่องยิงบาร์โค้ด'
                : scan.scanSource === 'upload'
                ? 'อัปโหลดรูป'
                : scan.scanSource === 'simulated'
                ? 'ทดสอบสแกน'
                : 'กล้อง QR';
              const scanResultLabel =
                scan.scanResult ||
                (syncState === 'synced'
                  ? 'สำเร็จ'
                  : syncState === 'failed'
                  ? 'บันทึกล้มเหลว'
                  : 'รอซิงค์');

              return (
                <div
                  key={`scan-${scan.firestoreDocId || scan.id || scan.scanId || 'item'}-${index}`}
                  onClick={() => onSelectScan(scan)}
                  className="bg-slate-800/80 hover:bg-slate-800 border border-white/5 hover:border-amber-500/30 rounded-2xl p-3.5 flex flex-col gap-2 cursor-pointer transition-all active:scale-[0.98] shadow-sm group"
                >
                  {/* Row 1: Name, Code, Grade, Room, Bus + Plate & Sync/Boarding Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                          isDropOff
                            ? 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                        }`}
                        title={statusLabel}
                      >
                        {isDropOff ? (
                          <LogOut className="w-4 h-4" />
                        ) : (
                          <LogIn className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-sm font-bold text-white truncate max-w-[160px] sm:max-w-none">
                            {scan.name}
                          </h4>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                            {scan.grade || '-'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700/80 text-slate-200 border border-white/10 shrink-0">
                            ห้อง {scan.room || '-'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                          <span className="font-mono text-slate-300">รหัส {scan.studentCode}</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-semibold">
                            {scan.busNumber || scan.carID || 'CAR01'}
                          </span>
                          {scan.plate && (
                            <span className="text-slate-300 font-mono">({scan.plate})</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Badges: Sync State & Boarding Type */}
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1">
                        {syncState === 'synced' ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
                            title="บันทึกและซิงค์กับ Firebase Cloud Firestore สำเร็จ"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            Synced
                          </span>
                        ) : syncState === 'failed' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRetryScan?.(scan);
                            }}
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 flex items-center gap-1"
                            title={scan.syncError || 'บันทึกล้มเหลว กดเพื่อลองซิงค์ใหม่'}
                          >
                            <span>⚠️ Failed · ลองใหม่</span>
                          </button>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"
                            title="กำลังรอซิงค์ขึ้น Firebase Cloud Firestore"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                            Pending
                          </span>
                        )}

                        {isDropOff ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center gap-1 shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                            ลงรถ
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            ขึ้นรถ
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Row 2: วันที่, เวลา, ผลการสแกน & ช่องทางสแกน */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-slate-900/60 px-3 py-1.5 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-slate-300">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-200">{scan.dateThai || '-'}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-mono font-bold text-amber-300">{scan.timeThai || scan.time || '-'}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 border border-white/5">
                        {isBarcodeGun ? <ScanBarcode className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                        <span>{scanSourceLabel}</span>
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium ${
                          syncState === 'failed'
                            ? 'bg-rose-500/20 text-rose-300'
                            : syncState === 'pending'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        ผล: {scanResultLabel}
                      </span>
                    </div>
                  </div>

                  {/* Row 3: ผู้สแกน, รหัสอุปกรณ์, สถานที่ และพิกัด GPS */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-[11px] text-slate-400 pt-0.5">
                    <div className="flex items-center gap-2.5 flex-wrap text-slate-300 min-w-0">
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="truncate max-w-[110px]">{scan.scannerName || 'เจ้าหน้าที่'}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
                        <Smartphone className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>{scan.device || 'MOBILE01'}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 truncate max-w-[160px] text-slate-300">
                        <MapPin className="w-3 h-3 text-rose-400 shrink-0" />
                        <span className="truncate">{scan.locationName || 'จุดรับส่ง'}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1 font-mono shrink-0 text-[10px]">
                      <span className="bg-slate-900/90 px-1.5 py-0.5 rounded border border-white/5 text-emerald-400">
                        {scan.latitude != null ? Number(scan.latitude).toFixed(4) : '-'},{' '}
                        {scan.longitude != null ? Number(scan.longitude).toFixed(4) : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pagination: Load older scans from Firestore */}
            {hasMoreScans && onLoadMoreScans && (
              <div className="pt-1 pb-4 flex justify-center">
                <button
                  type="button"
                  disabled={isLoadingMoreScans}
                  onClick={() => {
                    bumpActivity();
                    onLoadMoreScans();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-amber-300 border border-amber-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMoreScans ? 'animate-spin' : ''}`} />
                  <span>{isLoadingMoreScans ? 'กำลังโหลดประวัติย้อนหลัง...' : 'ดูประวัติสแกนย้อนหลังเพิ่มเติม'}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Voice Toggle (Bottom-Right FAB) */}
      <button
        className={`voice-fab ${soundEnabled ? 'active' : ''}`}
        id="btnVoice"
        type="button"
        onClick={onToggleSound}
        title={soundEnabled ? 'เสียงประกาศภาษาไทย: เปิดอยู่ (กดเพื่อปิด)' : 'เสียงประกาศภาษาไทย: ปิดอยู่ (กดเพื่อเปิด)'}
      >
        <span id="voiceIcon">{soundEnabled ? '🔊' : '🔇'}</span>
      </button>

      {/* Clear Confirmation Modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 max-w-xs w-full text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl mx-auto">
              🗑️
            </div>
            <div>
              <h3 className="text-base font-bold text-white">ล้างรายการสแกนทั้งหมด?</h3>
              <p className="text-xs text-slate-400 mt-1">
                การกระทำนี้จะลบประวัติการสแกนทั้งหมดออกจาก Firebase Cloud Firestore
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmClear(false)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmClear}
                className="flex-1 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 shadow-md shadow-rose-600/30"
              >
                ลบข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Daily Summary Report Modal */}
      <DailySummaryModal
        isOpen={showDailyReport}
        onClose={() => setShowDailyReport(false)}
        scans={scans}
        cars={cars}
        students={students}
      />
    </div>
  );
};
