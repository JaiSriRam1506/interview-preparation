export const useLiveKitUrl = () => {
  return (
    import.meta.env.VITE_LIVEKIT_URL ||
    import.meta.env.VITE_REACT_APP_LIVEKIT_URL ||
    ""
  );
};
