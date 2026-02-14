import React, { useEffect, useMemo, useRef, useState } from "react";

const formatSeconds = (s) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

export default function SessionTimer({ startedAt, expiresAt, onExpire }) {
  const start = useMemo(
    () => (startedAt ? new Date(startedAt) : null),
    [startedAt]
  );
  const exp = useMemo(
    () => (expiresAt ? new Date(expiresAt) : null),
    [expiresAt]
  );
  const [secondsLeft, setSecondsLeft] = useState(0);
  const expiredFiredRef = useRef(false);

  useEffect(() => {
    expiredFiredRef.current = false;

    const tick = () => {
      if (!start || !exp) return;
      const diff = Math.max(0, Math.floor((exp.getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0 && !expiredFiredRef.current && onExpire) {
        expiredFiredRef.current = true;
        onExpire();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [start, exp, onExpire]);

  return <span>{formatSeconds(secondsLeft)}</span>;
}
