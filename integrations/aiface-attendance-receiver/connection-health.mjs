// A heartbeat proves reachability, not when a queued scan happened.
// Compare scan time to an advancing, freshly sampled device clock. Its absolute
// date is deliberately never used as attendance time.
export function deviceClockTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const stamp = Date.parse(value.replace(" ", "T") + "+05:30");
  if (!Number.isFinite(stamp)) return null;
  const roundtrip = new Date(stamp + 330 * 60000).toISOString().slice(0, 19).replace("T", " ");
  return roundtrip === value ? stamp : null;
}

export class RecoveryWatchdog {
  constructor(now = Date.now()) {
    this.lastReplyAt = now;
    this.lastAttemptAt = now;
  }
  observe(now = Date.now()) { this.lastReplyAt = now; }
  due(now = Date.now()) {
    if (now - this.lastReplyAt < 180000 || now - this.lastAttemptAt < 180000) return false;
    this.lastAttemptAt = now;
    return true;
  }
}

export class ConnectionHealth {
  constructor(log = () => {}) {
    this.log = log;
    this.connected = false;
    this.heartbeatAt = 0;
    this.clock = null;
    this.stableSamples = 0;
    this.states = new Map();
  }
  transition(component, healthy, reason, now = Date.now()) {
    const prior = this.states.get(component);
    if (prior?.healthy === healthy && prior.reason === reason) return;
    this.states.set(component, { healthy, reason, since: now });
    this.log({ component, healthy, reason, observed_at: new Date(now).toISOString(),
      ...(prior && prior.healthy !== healthy ? { previous_state_duration_ms: now - prior.since } : {}) });
  }
  connect(now = Date.now()) {
    this.connected = true;
    this.heartbeatAt = 0;
    this.clock = null;
    this.stableSamples = 0;
    this.transition("mqtt", true, "subscribed", now);
    this.transition("device", false, "awaiting_fresh_reply", now);
    this.transition("device_clock", false, "awaiting_advancing_samples", now);
  }
  disconnect(now = Date.now()) {
    this.connected = false;
    this.heartbeatAt = 0;
    this.clock = null;
    this.stableSamples = 0;
    this.transition("mqtt", false, "connection_closed", now);
    this.transition("device", false, "mqtt_disconnected", now);
    this.transition("device_clock", false, "mqtt_disconnected", now);
  }
  heartbeat(now = Date.now()) {
    // A device gap invalidates clock continuity even if MQTT stayed connected.
    if (this.heartbeatAt && now - this.heartbeatAt > 45000) {
      this.clock = null;
      this.stableSamples = 0;
    }
    this.heartbeatAt = now;
    this.transition("device", true, "fresh_checklive_reply", now);
  }
  sample(value, requestedAt, now = Date.now()) {
    const deviceAt = deviceClockTime(value);
    if (!this.connected || !requestedAt || now < requestedAt || now - requestedAt >= 10000 || deviceAt === null) return false;
    const previous = this.clock;
    const elapsed = previous ? now - previous.receivedAt : 0;
    const advanced = previous ? deviceAt - previous.deviceAt : 0;
    const continuous = previous && elapsed >= 10000 && elapsed <= 45000 && advanced > 0 && Math.abs(advanced - elapsed) <= 3000;
    this.stableSamples = continuous ? this.stableSamples + 1 : 1;
    this.clock = { deviceAt, receivedAt: now };
    this.transition("device_clock", this.stableSamples >= 2,
      this.stableSamples >= 2 ? "advancing" : "awaiting_advancing_samples", now);
    return true;
  }
  tick(now = Date.now()) {
    if (this.connected && (!this.heartbeatAt || now - this.heartbeatAt > 45000)) {
      this.stableSamples = 0;
      this.clock = null;
      this.transition("device", false, "heartbeat_missing", now);
    }
    if (this.clock && now - this.clock.receivedAt > 45000) {
      this.stableSamples = 0;
      this.transition("device_clock", false, "clock_sample_expired", now);
    }
  }
  classify(message, receivedAt = Date.now()) {
    this.tick(receivedAt);
    let reason = null;
    if (!this.connected || !this.heartbeatAt || receivedAt - this.heartbeatAt > 45000) reason = "device_connection_unverified";
    else if (!this.clock || this.stableSamples < 2 || receivedAt - this.clock.receivedAt > 45000) reason = "device_clock_unverified";
    else if (message.count !== 1) reason = "buffered_batch";
    else {
      const raw = deviceClockTime(message.record?.[0]?.time);
      const estimated = this.clock.deviceAt + (receivedAt - this.clock.receivedAt);
      if (raw === null) reason = "device_time_missing_or_invalid";
      else if (raw > estimated + 3000) reason = "device_time_ahead";
      else if (estimated - raw > 10000) reason = "delayed_or_clock_changed";
    }
    return { time_source: reason ? "unverified" : "receiver_live", time_review_reason: reason };
  }
}
