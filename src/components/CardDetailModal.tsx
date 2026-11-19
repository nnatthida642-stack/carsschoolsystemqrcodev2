import React, { useState } from 'react';
import { ScanRecord, Student } from '../types';

interface CardDetailModalProps {
  scan: ScanRecord | null;
  studentDetails?: Student;
  onRetryScan?: (scan: ScanRecord) => void;
  onClose: () => void;
}

export const CardDetailModal: React.FC<CardDetailModalProps> = ({
  scan,
  studentDetails,
  onRetryScan,
  onClose,
}) => {
  const [showMapModal, setShowMapModal] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  if (!scan) return null;

  const lat = Number.isFinite(scan.latitude) ? scan.latitude : 13.7563;
  const lng = Number.isFinite(scan.longitude) ? scan.longitude : 100.5018;
  const coordsString = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const embedMapsUrl = `https://maps.google.com/maps?q=${lat},${lng}&hl=th&z=16&output=embed`;

  const syncState: 'pending' | 'synced' | 'failed' =
    scan.syncStatus || (scan.dbSaved ? 'synced' : 'pending');
  const isDropOff = scan.scanType === 'ลงรถ';
  const isBarcodeGun = scan.scanSource === 'barcode_scanner' || scan.scanSource === 'scanner';
  const scanSourceLabel = isBarcodeGun
    ? 'เครื่องยิงบาร์โค้ด'
    : scan.scanSource === 'upload'
    ? 'อัปโหลดรูปภาพ'
    : scan.scanSource === 'simulated'
    ? 'ทดสอบสแกน'
    : 'กล้องสแกน QR';

  const copyCoords = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(coordsString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      {/* ============ RESULT DETAIL SHEET ============ */}
      <div
        className={`sheet-overlay ${scan && !showMapModal ? 'active' : ''}`}
        id="detailSheet"
        onClick={onClose}
      >
        <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-grabber"></div>
          <div className="sheet-content w-full text-left" id="detailContent">
            {/* Header */}
            <div className="w-full flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <div>
                <span className="text-[11px] font-mono text-amber-400">
                  {scan.scanId}
                </span>
                <h3 className="text-base font-bold text-white">
                  ข้อมูลการสแกน{isDropOff ? 'ลงรถ' : 'ขึ้นรถ'}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            {/* Student / Employee Profile Card */}
            <div className="w-full flex items-center gap-3 bg-slate-800/80 p-3 rounded-2xl border border-white/10 mb-3">
              <img
                src={scan.avatar}
                alt={scan.name}
                className="w-12 h-12 rounded-full object-cover border-2 border-amber-400"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-bold text-white truncate">
                    {scan.name}
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                      isDropOff
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {scan.scanType || 'ขึ้นรถ'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                    {scan.grade || '-'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-200 font-medium">
                    ห้อง: {scan.room || '-'}
                  </span>
                  <span className="font-mono">รหัส: {scan.studentCode}</span>
                </div>
              </div>
            </div>

            {/* Info Rows */}
            <div className="w-full space-y-1.5 text-xs text-slate-300 mb-4 max-h-[42vh] overflow-y-auto pr-0.5">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-white/5">
                <span className="text-slate-400">🚌 รถรับส่ง / ทะเบียน:</span>
                <span className="font-semibold text-white">
                  {scan.busNumber || scan.carID || 'CAR01'} {scan.plate ? `(${scan.plate})` : ''}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-white/5">
                <span className="text-slate-400">📅 วันที่ / เวลาสแกน:</span>
                <span className="font-semibold text-emerald-400">
                  {scan.dateThai} · {scan.timeThai}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-white/5">
                <span className="text-slate-400">👤 ชื่อผู้สแกน / อุปกรณ์:</span>
                <span className="font-semibold text-white font-mono text-[11px]">
                  {scan.scannerName || 'เจ้าหน้าที่'} ({scan.device || 'MOBILE01'})
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-white/5">
                <span className="text-slate-400">📡 ช่องทางสแกน / ผลการสแกน:</span>
                <span className="font-semibold text-amber-300">
                  {scanSourceLabel} · {scan.scanResult || (syncState === 'synced' ? 'สำเร็จ' : 'รอซิงค์')}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-white/5 gap-2">
                <span className="text-slate-400">☁️ สถานะ Firebase Sync:</span>
                {syncState === 'synced' ? (
                  <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Synced (บันทึก Firebase แล้ว)
                  </span>
                ) : syncState === 'failed' ? (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-rose-400">Failed</span>
                    {onRetryScan && (
                      <button
                        type="button"
                        onClick={() => onRetryScan(scan)}
                        className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-[11px] font-semibold"
                      >
                        ลองซิงค์ใหม่
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="font-medium text-amber-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                    Pending (รอซิงค์ขึ้น Cloud)
                  </span>
                )}
              </div>
              {scan.syncError && (
                <div className="p-2 rounded-xl bg-rose-950/50 border border-rose-500/30 text-[11px] text-rose-300">
                  สาเหตุ: {scan.syncError}
                </div>
              )}
              {studentDetails?.parentPhone && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-white/5">
                  <span className="text-slate-400">📞 เบอร์โทรศัพท์:</span>
                  <a href={`tel:${studentDetails.parentPhone}`} className="font-semibold text-blue-400 underline">
                    {studentDetails.parentPhone}
                  </a>
                </div>
              )}
              <div className="p-3 rounded-2xl bg-slate-800/60 border border-white/10 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">📍 สถานที่สแกน:</span>
                  <span className="font-semibold text-amber-300 text-right">{scan.locationName || 'จุดรับส่ง'}</span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] bg-slate-900/80 p-2 rounded-xl">
                  <span className="text-slate-400 truncate">GPS: {coordsString}</span>
                  <button
                    type="button"
                    onClick={copyCoords}
                    className="px-2 py-1 rounded bg-slate-700 text-slate-200 hover:text-white text-[10px] shrink-0"
                  >
                    {copied ? '✓ คัดลอกแล้ว' : 'คัดลอกพิกัด'}
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="w-full flex gap-2">
              <button
                type="button"
                className="btn-ios-primary flex-1 text-xs"
                onClick={() => setShowMapModal(true)}
              >
                🗺️ ดูแผนที่ในแอป
              </button>
              <button
                type="button"
                className="btn-ios-plain flex-1 text-xs bg-slate-800/80 text-white rounded-full"
                onClick={onClose}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ MAP MODAL ============ */}
      <div
        className={`sheet-overlay ${showMapModal ? 'active' : ''}`}
        id="mapModal"
        onClick={() => setShowMapModal(false)}
      >
        <div className="bottom-sheet full" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-grabber"></div>
          <div className="map-container">
            <iframe
              id="mapIframe"
              src={embedMapsUrl}
              allowFullScreen
              loading="lazy"
              title="ตำแหน่งสแกนขึ้นรถ"
            ></iframe>
          </div>
          <div className="map-foot">
            <div id="mapInfo" className="text-xs text-slate-300 flex justify-between">
              <span>📍 {scan.locationName} ({scan.name})</span>
              <span className="font-mono text-emerald-400">{scan.timeThai}</span>
            </div>
            <div className="flex gap-2">
              <a
                id="mapOpenBtn"
                className="btn-ios-primary flex-1"
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                🗺️ เปิดใน Google Maps
              </a>
              <button
                type="button"
                className="btn-ios-plain px-4 bg-slate-800 text-slate-300 rounded-full text-xs"
                onClick={() => setShowMapModal(false)}
              >
                กลับ
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
