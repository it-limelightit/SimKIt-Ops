import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mqttPacket from "mqtt-packet";

test(
  "bridge HTTP publishing authenticates, maps template, and deduplicates MQTT commands",
  { timeout: 15000 },
  async () => {
    const sockets = new Set();
    const published = [];
    const broker = createServer((socket) => {
      socket.on("error", () => {}); // Child shutdown may reset the mock broker socket.
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const parser = mqttPacket.parser();
      socket.on("data", (bytes) => parser.parse(bytes));
      parser.on("packet", (packet) => {
        if (packet.cmd === "connect")
          socket.write(
            mqttPacket.generate({ cmd: "connack", returnCode: 0, sessionPresent: false }),
          );
        if (packet.cmd === "subscribe")
          socket.write(
            mqttPacket.generate({
              cmd: "suback",
              messageId: packet.messageId,
              granted: packet.subscriptions.map(() => 1),
            }),
          );
        if (packet.cmd === "publish") {
          published.push(packet);
          socket.write(mqttPacket.generate({ cmd: "puback", messageId: packet.messageId }));
        }
        if (packet.cmd === "pingreq") socket.write(mqttPacket.generate({ cmd: "pingresp" }));
      });
    });
    await new Promise((resolve) => broker.listen(0, "127.0.0.1", resolve));
    const candidate = createServer();
    await new Promise((resolve) => candidate.listen(0, "127.0.0.1", resolve));
    const port = candidate.address().port;
    await new Promise((resolve) => candidate.close(resolve));
    const directory = mkdtempSync(join(tmpdir(), "simkit-attendance-test-"));
    const template = join(directory, "template.json");
    writeFileSync(
      template,
      JSON.stringify({ test_operation: "enroll", id: "{{enroll_id}}", name: "{{name}}" }),
    );
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      env: {
        ...process.env,
        MQTT_URL: `mqtt://127.0.0.1:${broker.address().port}`,
        MQTT_CLIENT_ID: "test-attendance-client",
        ATTENDANCE_DEVICE_ID: "test-device",
        ATTENDANCE_EVENT_TOPICS: "test/scan",
        ATTENDANCE_COMMAND_TOPIC: "test/enroll",
        ATTENDANCE_DEVICE_TIME_OFFSET: "+05:30",
        ATTENDANCE_DEVICE_WEBHOOK_URL: "https://example.invalid/functions",
        ATTENDANCE_DEVICE_WEBHOOK_SECRET: "test-webhook",
        ATTENDANCE_PUBLISH_SECRET: "test-publishing",
        ATTENDANCE_ENROLL_TEMPLATE_FILE: template,
        BRIDGE_HOST: "127.0.0.1",
        BRIDGE_PORT: String(port),
        BRIDGE_DB: join(directory, "queue.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on("data", (data) => {
          if (data.toString().includes("started")) resolve();
        });
        child.on("exit", (code) => reject(new Error(`Bridge exited ${code}`)));
      });
      const command = {
        command_id: "00000000-0000-4000-8000-000000000004",
        device_id: "test-device",
        topic: "test/enroll",
        operation: "enroll",
        employee: { enroll_id: "00104", name: "Rahul", department: "software" },
      };
      const send = (secret, data = command) =>
        fetch(`http://127.0.0.1:${port}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-attendance-secret": secret },
          body: JSON.stringify(data),
        });
      assert.equal((await send("incorrect")).status, 401);
      assert.equal(
        (await send("test-publishing", { ...command, topic: "other/topic" })).status,
        403,
      );
      let response;
      for (let attempt = 0; attempt < 20; attempt++) {
        response = await send("test-publishing");
        if (response.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(response.status, 200);
      assert.equal((await send("test-publishing")).status, 200);
      assert.equal(published.length, 1);
      assert.equal(published[0].topic, "test/enroll");
      assert.deepEqual(JSON.parse(published[0].payload.toString()), {
        test_operation: "enroll",
        id: "00104",
        name: "Rahul",
      });
    } finally {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => broker.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
