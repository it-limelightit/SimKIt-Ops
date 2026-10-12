// End the scan's India calendar day, then retain photos until 02:00 the next day.
export function photoExpiryTime(scannedAt) {
  const local = new Date(Date.parse(scannedAt) + 330 * 60000);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 2) - 330 * 60000
  );
}

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

export function deviceProfile(message, packet, deviceId, topic, now = Date.now()) {
  if (packet.retain || packet.topic !== topic || message.cmd !== "senduser") return null;
  if (message.sn !== deviceId || Number(message.backupnum) !== 50) return null;
  if (!Number.isSafeInteger(message.enrollid) || message.enrollid < 0) return null;
  if (!inferPhotoMime(message.record)) return null;
  // Enrollment photos are not attendance photos. Forward no name or image data.
  return {
    kind: "device_profile",
    device_id: deviceId,
    topic,
    enroll_id: String(message.enrollid),
    observed_at: new Date(now).toISOString(),
  };
}
