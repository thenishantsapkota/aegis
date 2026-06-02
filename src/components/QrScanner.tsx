import { useEffect, useRef, useState } from "react";
import {
  BrowserQRCodeReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { AlertTriangle, Camera, RefreshCcw } from "lucide-react";

type Props = {
  onScan: (text: string) => void;
};

type Status = "idle" | "requesting" | "scanning" | "error";

export function QrScanner({ onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const framesRef = useRef(0);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [framesTried, setFramesTried] = useState(0);

  const isSecureContext =
    typeof window !== "undefined" &&
    (window.isSecureContext || location.hostname === "localhost");

  function stopAll() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

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

    stopAll();
    setError(null);
    setFramesTried(0);
    framesRef.current = 0;
    setStatus("requesting");

    const id = targetId === undefined ? deviceId : targetId;
    const baseVideo: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
    const videoConstraints: MediaTrackConstraints = id
      ? { ...baseVideo, deviceId: { exact: id } }
      : { ...baseVideo, facingMode: { ideal: "environment" } };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
    } catch (e) {
      setStatus("error");
      setError(friendlyError(e));
      return;
    }
    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch (e) {
      // Some browsers reject play() if not in a gesture context. We surface
      // the error but leave the stream attached — user can tap Allow camera
      // again, which IS in a gesture and will then succeed.
      stopAll();
      setStatus("error");
      setError(friendlyError(e));
      return;
    }

    // Best-effort: enable continuous autofocus where supported.
    const [track] = stream.getVideoTracks();
    if (track) {
      try {
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
          focusMode?: string[];
        };
        if (caps.focusMode?.includes("continuous")) {
          await track.applyConstraints({
            advanced: [
              { focusMode: "continuous" } as MediaTrackConstraintSet,
            ],
          });
        }
      } catch {
        /* ignore — best-effort */
      }
    }

    // Build the QR reader with TRY_HARDER to chew on dense codes.
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserQRCodeReader(hints, {
      delayBetweenScanAttempts: 100,
    });

    setStatus("scanning");
    try {
      const controls = await reader.decodeFromVideoElement(
        video,
        (result, _err, ctl) => {
          // Every callback (hit or miss) bumps the frame counter so the UI
          // can show "looking…" feedback.
          framesRef.current += 1;
          if (framesRef.current % 5 === 0) setFramesTried(framesRef.current);
          if (result) {
            ctl.stop();
            stopAll();
            onScan(result.getText());
          }
        },
      );
      controlsRef.current = controls;
    } catch (e) {
      stopAll();
      setStatus("error");
      setError(friendlyError(e));
      return;
    }

    // After permission is granted, enumerate cameras so the picker populates.
    try {
      const list = await BrowserQRCodeReader.listVideoInputDevices();
      setDevices(list);
      if (id === null) {
        const settings = track?.getSettings();
        if (settings?.deviceId) setDeviceId(settings.deviceId);
      }
    } catch {
      /* listing isn't critical */
    }
  }

  useEffect(() => {
    return () => stopAll();
  }, []);

  // Auto-start once on mount. iOS may reject this without a direct gesture;
  // the user can tap "Allow camera" to retry within one.
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

        {status === "scanning" && (
          <div className="absolute top-2 right-2 text-[10px] font-mono text-white/70 bg-black/40 backdrop-blur px-2 py-0.5 rounded-full">
            looking…{framesTried > 0 ? ` ${framesTried}f` : ""}
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

      {status === "scanning" && framesTried >= 60 && (
        <div className="text-xs text-muted text-center leading-relaxed">
          Still looking? Move closer (the QR should fill the dashed box), hold
          steady, and make sure there's no glare. Tap{" "}
          <button
            type="button"
            onClick={() => void start(deviceId)}
            className="text-accent underline-offset-2 underline"
          >
            restart
          </button>{" "}
          if it seems stuck.
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
      return "No camera found on this device.";
    case "OverconstrainedError":
      return "The selected camera doesn't support the requested settings. Try a different camera.";
    case "NotReadableError":
      return "Camera is in use by another app. Close any other app using the camera and try again.";
    case "AbortError":
      return "Camera start was interrupted. Tap Allow camera to retry.";
    default:
      return e.message || "Could not start the camera.";
  }
}
