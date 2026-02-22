import { useEffect, useState } from "react";

// Minimal quality indicator (LiveKit already adapts automatically).
export const useConnectionQuality = (room) => {
  const [quality, setQuality] = useState("unknown");

  useEffect(() => {
    if (!room) return;

    const update = () => {
      const state = String(room.connectionState || "");
      if (state === "connected") setQuality("good");
      else if (state === "reconnecting") setQuality("poor");
      else if (state === "connecting") setQuality("fair");
      else setQuality("unknown");
    };

    update();
    room.on("connectionStateChanged", update);
    return () => {
      room.off("connectionStateChanged", update);
    };
  }, [room]);

  return quality;
};
