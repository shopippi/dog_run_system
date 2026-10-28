import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** 文字列を QR コードの画像にする(端末の中で作る。apps/liff の QrImage と同じ作り) */
export function QrImage({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img className="qr" src={src} width={size} height={size} alt={label} />
  ) : (
    <div className="qr" style={{ width: size, height: size }} />
  );
}
