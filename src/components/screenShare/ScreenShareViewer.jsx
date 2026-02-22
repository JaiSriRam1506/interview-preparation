import React, { useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Maximize2, Square } from "lucide-react";
import toast from "react-hot-toast";
import { Room } from "livekit-client";
import { useSocket } from "../../contexts/SocketContext";
import { useScreenShare } from "../../contexts/ScreenShareContext";
import LoadingSpinner from "../common/LoadingSpinner";
import { useLiveKitUrl } from "../../hooks/useLiveKitUrl";
import { useConnectionQuality } from "../../hooks/useConnectionQuality";
import { useAutoReconnect } from "../../hooks/useAutoReconnect";

export default function ScreenShareViewer({ showUi = true } = {}) {
  const { socket } = useSocket();
  const livekitUrl = useLiveKitUrl();
  const { currentSession, setConnectionStatus, leaveSession } =
    useScreenShare();

  const [room, setRoom] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [connecting, setConnecting] = useState(true);

  const videoRef = useRef(null);
  const containerRef = useRef(null);

  const quality = useConnectionQuality(room);
  const reconnecting = useAutoReconnect(room);

  const sessionId = currentSession?.sessionId;
  const token = useMemo(() => {
    const raw = currentSession?.token;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      if (typeof raw.jwt === "string") return raw.jwt;
      if (typeof raw.token === "string") return raw.token;
    }
    return "";
  }, [currentSession?.token]);
  const canRun = currentSession?.role === "viewer" && sessionId && token;

  const statusLabel = useMemo(() => {
    if (!room) return "idle";
    if (reconnecting) return "reconnecting";
    return String(room.connectionState || "unknown");
  }, [room, reconnecting]);

  useEffect(() => {
    if (!socket || !sessionId) return;
    socket.emit("join-screen-room", { sessionId });
    const onEnded = () => {
      toast.error("Sharing ended");
      leaveSession();
    };
    socket.on("sharing-ended", onEnded);
    return () => {
      socket.emit("leave-screen-room", { sessionId });
      socket.off("sharing-ended", onEnded);
    };
  }, [socket, sessionId, leaveSession]);

  useEffect(() => {
    if (!canRun) return;
    if (!livekitUrl) {
      toast.error("Missing VITE_LIVEKIT_URL");
      return;
    }

    let mounted = true;
    const videoEl = videoRef.current;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    setRoom(r);
    setConnectionStatus("connecting");
    setConnecting(true);

    const start = async () => {
      try {
        await r.connect(livekitUrl, token);
        if (!mounted) return;

        setConnectionStatus("connected");
        setConnecting(false);

        const attachFirstRemoteVideo = () => {
          for (const p of r.remoteParticipants.values()) {
            for (const pub of p.videoTrackPublications.values()) {
              const track = pub.track;
              if (track && videoRef.current) {
                track.attach(videoRef.current);
                return;
              }
            }
          }
        };

        // Attach on existing + future tracks.
        attachFirstRemoteVideo();
        r.on("trackSubscribed", () => attachFirstRemoteVideo());
      } catch (e) {
        const msg = e?.message || "Failed to connect";
        toast.error(msg);
        setConnectionStatus("error");
        setConnecting(false);
      }
    };

    start();

    return () => {
      mounted = false;
      try {
        if (videoEl) {
          // LiveKit will detach on disconnect, but ensure UI clears quickly.
          videoEl.srcObject = null;
        }
      } catch {
        // ignore
      }
      try {
        r.disconnect();
      } catch {
        // ignore
      }
      setRoom(null);
    };
  }, [canRun, livekitUrl, token, setConnectionStatus]);

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
    } catch {
      // ignore
    }
  };

  const onLeave = () => {
    leaveSession();
  };

  if (!canRun) return null;

  if (!showUi) {
    return null;
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Viewing{" "}
            {currentSession?.sharerName
              ? `${currentSession.sharerName}'s`
              : "a"}{" "}
            screen
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Status: {statusLabel} · Quality: {quality}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
            aria-label="Toggle fullscreen"
          >
            {fullscreen ? (
              <Square className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onLeave}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-semibold"
          >
            <LogOut className="h-4 w-4" /> Leave
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="mt-4 rounded-lg overflow-hidden bg-black"
      >
        {connecting && (
          <div className="py-10">
            <LoadingSpinner fullScreen={false} />
          </div>
        )}
        <video
          ref={videoRef}
          className="w-full h-[320px] sm:h-[520px] object-contain"
          playsInline
          aria-label="Remote screen"
        />
      </div>
    </div>
  );
}
