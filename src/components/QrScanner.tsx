import { useEffect, useRef, useState } from "react";
import {
  BrowserQRCodeReader,
  type IScannerControls,
} from "@zxing/browser";
import { AlertTriangle, Camera, RefreshCcw } from "lucide-react";

type Props = {
  onScan: (text: string) => void;
};

type Status = "idle" | "requesting" | "scanning" | "error";

export function QrScanner({ onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // null = "auto" (use facingMode), otherwise an explicit device id
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const isSecureContext =
    typeof window !== "undefined" &&
    (window.isSecureContext || location.hostname === "localhost");

  // Start scanning. iOS/Safari requires the very first call to happen inside
  // a user gesture; after permission is granted, subsequent calls are silent.
  async function start(targetId?: string | null) {
    if (!videoRef.current) return;
    if (!isSecureContext) {
      setStatus("error");
      setError(
        "Camera requires HTTPS. Open this site over https:// (or localhost) and try again.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("This browser doesn't support camera access.");
      return;
    }
    setError(null);
    setStatus("requesting");
    try {
      controlsRef.current?.stop();
      const reader =
        readerRef.current ??
        (readerRef.current = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 200,
        }));

      // If we know the device id, pin to it. Otherwise ask for the
      // back-facing camera and let the browser pick. decodeFromConstraints
      // triggers the permission prompt itself — no need to pre-enumerate.
      const id = targetId === undefined ? deviceId : targetId;
      const constraints: MediaStreamConstraints = id
        ? { video: { deviceId: { exact: id } }, audio: false }
        : {
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          };

      const controls = await reader.decodeFromConstraints(
        constraints,
        videoRef.current,
        (result, _err, ctl) => {
          if (result) {
            ctl.stop();
            controlsRef.current = null;
            onScan(result.getText());
          }
        },
      );
      controlsRef.current = controls;
      setStatus("scanning");

      // Now that the user has granted permission, list cameras so they can
      // switch front ↔ back without re-prompting.
      try {
        const list = await BrowserQRCodeReader.listVideoInputDevices();
        setDevices(list);
        if (id === null) {
          const stream = videoRef.current.srcObject as MediaStream | null;
          const track = stream?.getVideoTracks()[0];
          const settings = track?.getSettings();
          if (settings?.deviceId) setDeviceId(settings.deviceId);
        }
      } catch {
        /* listing isn't critical — ignore */
      }
    } catch (e) {
      controlsRef.current = null;
      setStatus("error");
      setError(friendlyError(e));
    }
  }

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  // Auto-start once on mount. If permission was previously granted, this is
  // silent. If not, it shows the browser prompt. iOS Safari may reject the
  // auto-call without a user gesture — in that case the user taps "Allow
  // camera" to retry within a real gesture.
  useEffect(() => {
    void start(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchCamera(newId: string) {
    setDeviceId(newId);
    await start(newId);
  }

  const showStartButton = status === "idle" || status === "error";

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black border border-border">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-[12%] border-2 border-white/40 rounded-2xl" />
        </div>

        {status === "requesting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="text-sm text-white animate-pulse">
              Requesting camera…
            </div>
          </div>
        )}

        {showStartButton && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-4">
            <div className="text-center max-w-xs">
              {error ? (
                <>
                  <AlertTriangle
                    className="mx-auto mb-2 text-warn"
                    size={28}
                  />
                  <div className="text-sm text-white mb-3">{error}</div>
                  <p className="text-[11px] text-muted mb-3 leading-relaxed">
                    iOS: open in Safari (not in-app browsers like Instagram /
                    Twitter) and allow camera when prompted. Android Chrome:
                    tap the lock icon in the address bar → Permissions →
                    Camera → Allow.
                  </p>
                </>
              ) : (
                <p className="text-sm text-white mb-3">
                  Aegis needs camera access to scan QR codes.
                </p>
              )}
              <button
                type="button"
                onClick={() => void start(null)}
                className="btn-primary"
              >
                <Camera size={16} /> Allow camera
              </button>
            </div>
          </div>
        )}
      </div>

      {devices.length > 1 && status === "scanning" && (
        <div className="flex items-center gap-2 text-sm">
          <Camera size={14} className="text-muted" />
          <select
            value={deviceId ?? ""}
            onChange={(e) => void switchCamera(e.target.value)}
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
            onClick={() => void start(deviceId)}
            className="btn-ghost px-2 py-1.5"
            aria-label="Restart camera"
          >
            <RefreshCcw size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const name = (e as Error & { name?: string }).name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access in your browser settings, then tap Allow camera.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera matches the requested settings. Try switching to another camera.";
    case "NotReadableError":
      return "Camera is in use by another app. Close any other app using the camera and try again.";
    case "AbortError":
      return "Camera start was interrupted. Tap Allow camera to retry.";
    default:
      return e.message || "Could not start the camera.";
  }
}
