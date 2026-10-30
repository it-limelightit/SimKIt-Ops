import { DatabaseSync } from "node:sqlite";
export class EventQueue {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL);`);
    // Older releases stopped after 20 attempts. Resume those durable records too.
    this.db.prepare("UPDATE events SET status='pending' WHERE status='dead'").run();
  }
  put(event) {
    const { photo_base64, photo_mime, ...metadata } = event;
    const id =
      event.kind === "scan"
        ? `scan:${event.event_id}`
        : event.kind === "device_profile"
          ? `profile:${event.device_id}:${event.enroll_id}:${event.observed_at}`
          : event.kind === "receiver_health"
            ? `health:${event.event_id}`
          : event.kind === "enrollment_ack"
            ? `ack:${event.command_id}:${event.success}`
            : `heartbeat:${Date.now()}`;
    if (this.db.prepare("SELECT id FROM events WHERE id=?").get(id)) return id;
    if (this.db.prepare("SELECT count(*) AS count FROM events").get().count >= 10000)
      this.db
        .prepare(
          "DELETE FROM events WHERE id IN (SELECT id FROM events WHERE status='delivered' ORDER BY created_at LIMIT 1000)",
        )
        .run();
    if (this.db.prepare("SELECT count(*) AS count FROM events").get().count >= 10000)
      throw new Error("Queue full; operator review required");
    this.db
      .prepare("INSERT INTO events(id,body,created_at) VALUES(?,?,?)")
      .run(id, JSON.stringify(metadata), Date.now());
    return id;
  }
  ready() {
    return this.db
      .prepare(
        "SELECT * FROM events WHERE status='pending' AND next_at<=? ORDER BY created_at LIMIT 20",
      )
      .all(Date.now());
  }
  finish(id) {
    this.db.prepare("UPDATE events SET status='delivered' WHERE id=?").run(id);
  }
  retry(id) {
    this.db
      .prepare(
        "UPDATE events SET attempts=attempts+1,status='pending',next_at=? WHERE id=?",
      )
      .run(Date.now() + 60000, id);
  }
  prune() {
    this.db
      .prepare("DELETE FROM events WHERE status='delivered' AND created_at<?")
      .run(Date.now() - 7 * 86400000);
  }
  stats() {
    return this.db.prepare("SELECT count(*) AS pending,min(created_at) AS oldest_at,max(attempts) AS max_attempts FROM events WHERE status='pending'").get();
  }
  close() {
    this.db.close();
  }
}
