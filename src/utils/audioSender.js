export function makeWS(url, onMessage) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => console.info("WS connected to", url);
  ws.onmessage = (ev) => onMessage?.(ev);
  ws.onclose = () => console.warn("WS closed", url);
  ws.onerror = (e) => console.error("WS error", e);
  return ws;
}

// frame = header length (u32 little-endian) + header JSON bytes + audio bytes (int16 pcm)
export function packFrame(headerObj, int16Array) {
  const headerStr = JSON.stringify(headerObj);
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(headerStr);
  const headerLenBuf = new Uint32Array([headerBytes.length]).buffer;

  const payload = new Uint8Array(
    4 + headerBytes.length + int16Array.byteLength
  );
  payload.set(new Uint8Array(headerLenBuf), 0);
  payload.set(headerBytes, 4);
  payload.set(new Uint8Array(int16Array.buffer), 4 + headerBytes.length);
  return payload.buffer;
}
