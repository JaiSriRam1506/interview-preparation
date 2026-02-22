import { useEffect, useState } from "react";

// LiveKit handles reconnection internally; this hook just exposes a friendly state.
export const useAutoReconnect = (room) => {
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!room) return;
    const onState = () => {
      setIsReconnecting(String(room.connectionState) === "reconnecting");
    };
    onState();
    room.on("connectionStateChanged", onState);
    return () => room.off("connectionStateChanged", onState);
  }, [room]);

  return isReconnecting;
};
