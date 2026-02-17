// Generic runtime/browser helpers used by InterviewSession.

export const isProbablyInsecureContext = () => {
  try {
    if (typeof window === "undefined") return false;
    if (window.isSecureContext) return false;
    const host = String(window.location?.hostname || "").toLowerCase();
    // localhost is treated as secure in many browsers.
    if (host === "localhost" || host === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
};

export const isAndroidBrowser = () => {
  try {
    return /android/i.test(String(navigator?.userAgent || ""));
  } catch {
    return false;
  }
};

// Some browsers occasionally throw an unhandled rejection when closing an
// already-closed AudioContext. This is benign but noisy; suppress only that case.
export const installAudioContextCloseSuppression = () => {
  const handler = (event) => {
    try {
      const reason = event?.reason;
      const name = String(reason?.name || "");
      const msg = String(reason?.message || "").toLowerCase();
      if (
        name === "InvalidStateError" &&
        msg.includes("cannot close a closed audiocontext")
      ) {
        event.preventDefault?.();
      }
    } catch {
      // ignore
    }
  };

  try {
    window.addEventListener("unhandledrejection", handler);
  } catch {
    // ignore
  }

  return () => {
    try {
      window.removeEventListener("unhandledrejection", handler);
    } catch {
      // ignore
    }
  };
};
