export function heartbeatReply(message, packet, deviceId, pendingAt, now = Date.now()) {
  return (
    !packet.retain &&
    pendingAt > 0 &&
    now >= pendingAt &&
    now - pendingAt < 10000 &&
    message.ret === "checklive" &&
    message.sn === deviceId &&
    message.result === true
  );
}

export function inferPhotoMime(image) {
  if (typeof image !== "string" || !image || image.length > 2800000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return null;
  const bytes = Buffer.from(image, "base64");
  if (bytes.length > 2097152) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(bytes.subarray(0, 8)))
    return "image/png";
  return null;
}
