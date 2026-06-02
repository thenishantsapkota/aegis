import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { AlertTriangle, Camera, RefreshCcw } from "lucide-react";

type Props = {
  onScan: (text: string) => void;
};

export function QrScanner({ onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // List cameras (we want to default to a back-facing one on mobile).
  useEffect(() => {
    let mounted = true;
    BrowserQRCodeReader.listVideoInputDevices()
      .then((d) => {
        if (!mounted) return;
        setDevices(d);
        if (!deviceId && d.length) {
          const back =
            d.find((x) => /back|rear|environment/i.test(x.label)) ?? d[0];
          setDeviceId(back.deviceId);
        }
      })
      .catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      mounted = false;
    };
  }, [deviceId]);

  // Start scanning when deviceId is set.
  useEffect(() => {
    if (!deviceId || !videoRef.current) return;
    let cancelled = false;
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 200,
    });
    setError(null);
    reader
      .decodeFromVideoDevice(deviceId, videoRef.current, (result, err, ctl) => {
        if (cancelled) {
          ctl.stop();
          return;
        }
        if (result) {
          ctl.stop();
          onScan(result.getText());
        }
      })
      .then((ctl) => {
        controlsRef.current = ctl;
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `${e.name === "NotAllowedError" ? "Camera permission denied. " : ""}${e.message}`
              : String(e),
          );
        }
      });
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [deviceId, onScan]);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black border border-border">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
        />
        {/* Reticle */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-[12%] border-2 border-white/40 rounded-2xl" />
        </div>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/80 px-4">
            <div className="text-center">
              <AlertTriangle className="mx-auto mb-2 text-warn" size={28} />
              <div className="text-sm text-white">{error}</div>
              <p className="text-xs text-muted mt-2">
                On iOS, camera works only inside Safari (or the home-screen
                PWA) and requires HTTPS.
              </p>
            </div>
          </div>
        )}
      </div>
      {devices.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Camera size={14} className="text-muted" />
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="input py-1.5 text-xs flex-1"
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDeviceId((id) => id)}
            className="btn-ghost px-2 py-1.5"
            aria-label="Retry"
          >
            <RefreshCcw size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
