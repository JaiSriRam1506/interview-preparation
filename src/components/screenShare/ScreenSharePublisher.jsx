import React, { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Square, StopCircle, Users } from "lucide-react";
import toast from "react-hot-toast";
import { LocalVideoTrack, Room, Track } from "livekit-client";
import { useSocket } from "../../contexts/SocketContext";
import { useScreenShare } from "../../contexts/ScreenShareContext";
import LoadingSpinner from "../common/LoadingSpinner";
import { useLiveKitUrl } from "../../hooks/useLiveKitUrl";
import { useConnectionQuality } from "../../hooks/useConnectionQuality";
import { useAutoReconnect } from "../../hooks/useAutoReconnect";

const requestDisplayMedia = async () => {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 30 },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
};

export default function ScreenSharePublisher({ showUi = true } = {}) {
  const { socket } = useSocket();
  const livekitUrl = useLiveKitUrl();
  const { currentSession, setConnectionStatus, endSession } = useScreenShare();

  const [room, setRoom] = useState(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const publishedTrackRef = useRef(null);

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
  const canRun = currentSession?.role === "sharer" && sessionId && token;

  const statusLabel = useMemo(() => {
    if (!room) return "idle";
    if (reconnecting) return "reconnecting";
    return String(room.connectionState || "unknown");
  }, [room, reconnecting]);

  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit("join-screen-room", { sessionId });

    const onJoined = (payload) => {
      if (typeof payload?.participants === "number") {
        setViewerCount(Math.max(0, payload.participants - 1));
      }
    };
    const onUserJoined = () => setViewerCount((c) => c + 1);
    const onUserLeft = () => setViewerCount((c) => Math.max(0, c - 1));

    socket.on("room-joined", onJoined);
    socket.on("user-joined", onUserJoined);
    socket.on("user-left", onUserLeft);
    socket.on("user-disconnected", onUserLeft);

    return () => {
      socket.emit("leave-screen-room", { sessionId });
      socket.off("room-joined", onJoined);
      socket.off("user-joined", onUserJoined);
      socket.off("user-left", onUserLeft);
      socket.off("user-disconnected", onUserLeft);
    };
  }, [socket, sessionId]);

  const stopLocalSharing = () => {
    try {
      const t = publishedTrackRef.current;
      if (t) {
        t.stop();
        publishedTrackRef.current = null;
      }
    } catch {
      // ignore
    }
    try {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } catch {
      // ignore
    }
    try {
      room?.disconnect();
    } catch {
      // ignore
    }
    setRoom(null);
    setStarted(false);
  };

  useEffect(() => {
    // Cleanup when leaving this session / switching sessions.
    if (!canRun) {
      stopLocalSharing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun]);

  const startSharing = async () => {
    if (!canRun) return;
    if (starting || started) return;
    if (!livekitUrl) {
      toast.error("Missing VITE_LIVEKIT_URL");
      return;
    }

    setStarting(true);
    setConnectionStatus("connecting");

    const r = new Room({ adaptiveStream: true, dynacast: true });
    setRoom(r);

    try {
      await r.connect(livekitUrl, token);

      // IMPORTANT: Browsers usually require this to be called from a user gesture.
      const stream = await requestDisplayMedia();
      const [screenTrack] = stream.getVideoTracks();
      if (!screenTrack) throw new Error("No screen video track");

      // Stop session if user stops sharing from browser UI.
      screenTrack.onended = () => {
        endSession();
      };

      const local = new LocalVideoTrack(screenTrack, { name: "screen" });
      publishedTrackRef.current = local;

      await r.localParticipant.publishTrack(local, {
        source: Track.Source.ScreenShare,
        simulcast: true,
      });

      if (videoRef.current) {
        local.attach(videoRef.current);
      }

      setStarted(true);
      setConnectionStatus("connected");
      socket?.emit("sharing-started", { sessionId });
    } catch (e) {
      const msg = e?.message || "Failed to start sharing";
      toast.error(msg);
      setConnectionStatus("error");
      try {
        r.disconnect();
      } catch {
        // ignore
      }
      setRoom(null);
      setStarted(false);
    } finally {
      setStarting(false);
    }
  };

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

  if (!canRun) return null;

  if (!showUi) {
    return null;
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            You are sharing
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Status: {statusLabel} · Quality: {quality}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">
            <Users className="h-4 w-4" /> {viewerCount}
          </div>
          {!started && (
            <button
              onClick={startSharing}
              disabled={starting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-semibold disabled:opacity-60"
            >
              {starting ? "Starting..." : "Start sharing"}
            </button>
          )}
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
            onClick={endSession}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold"
          >
            <StopCircle className="h-4 w-4" /> Stop
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="mt-4 rounded-lg overflow-hidden bg-black"
      >
        {starting && (
          <div className="py-10">
            <LoadingSpinner fullScreen={false} />
          </div>
        )}
        <video
          ref={videoRef}
          className="w-full h-[320px] sm:h-[420px] object-contain"
          muted
          playsInline
          aria-label="Screen share preview"
        />
      </div>
    </div>
  );
}
