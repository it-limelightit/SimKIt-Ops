import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
let publishMqtt, mqttConfig, renderMqttEnrollment;
before(async () => {
  const js = ts.transpileModule(
    readFileSync(
      new URL("../supabase/functions/_shared/attendance-mqtt.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  ({ publishMqtt, mqttConfig, renderMqttEnrollment } = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  ));
});
const command = {
  id: "00000000-0000-4000-8000-000000000004",
  name: "Rahul",
  department: "software",
  enroll_id: "00104",
};
const rules = {
  topic: "device/reply",
  kind_path: "ret",
  kind_value: "enroll",
  command_id_path: "request_id",
  enroll_id_path: "user.id",
  serial_path: "sn",
  success_path: "ok",
  success_value: true,
  failure_value: false,
};
const config = {
  host: "test",
  port: 1883,
  tls: false,
  username: "user",
  password: "password",
  deviceId: "serial",
  topic: "device/command",
  template: {
    operation: "TEST_ONLY",
    request_id: "{{command_id}}",
    id: "{{enroll_id}}",
    name: "{{name}}",
  },
  timeoutMs: 80,
};
function packet(header, body = []) {
  let size = body.length;
  const length = [];
  do {
    let byte = size % 128;
    size = Math.floor(size / 128);
    if (size) byte |= 128;
    length.push(byte);
  } while (size);
  return Uint8Array.from([header, ...length, ...body]);
}
function reply(data, { retained = false, qos = 0 } = {}) {
  const topic = Buffer.from(rules.topic);
  const id = qos ? [0, 7] : [];
  return packet(0x30 | (retained ? 1 : 0) | (qos << 1), [
    topic.length >> 8,
    topic.length & 255,
    ...topic,
    ...id,
    ...Buffer.from(JSON.stringify(data)),
  ]);
}
const ack = (extra = {}) => ({
  ret: "enroll",
  request_id: command.id,
  sn: config.deviceId,
  user: { id: command.enroll_id },
  ok: true,
  ...extra,
});
class FakeConnection {
  constructor({
    messages = [],
    puback = true,
    connack = true,
    subscription = true,
    failPublish = false,
    fragment = false,
  } = {}) {
    Object.assign(this, { messages, puback, connack, subscription, failPublish, fragment });
    this.pending = [];
    this.writes = [];
    this.closed = false;
  }
  async read(target) {
    if (!this.pending.length) return new Promise((resolve) => (this.waiter = () => resolve(null)));
    const bytes = this.pending[0];
    const count = Math.min(target.length, bytes.length, this.fragment ? 1 : 65536);
    target.set(bytes.subarray(0, count));
    if (count === bytes.length) this.pending.shift();
    else this.pending[0] = bytes.subarray(count);
    return count;
  }
  async write(bytes) {
    this.writes.push(new Uint8Array(bytes));
    const type = bytes[0] >> 4;
    if (type === 1) this.pending.push(packet(0x20, [0, this.connack ? 0 : 5]));
    if (type === 8) this.pending.push(packet(0x90, [0, 1, this.subscription ? 0 : 128]));
    if (type === 3) {
      if (this.failPublish) throw new Error("Network dropped");
      if (this.puback) this.pending.push(packet(0x40, [0, 2]));
      this.pending.push(...this.messages);
    }
    return bytes.length;
  }
  close() {
    this.closed = true;
    this.waiter?.();
  }
}
test("direct MQTT publishes actual template bytes with QoS 1 and closes connection", async () => {
  const connection = new FakeConnection({ fragment: true });
  const result = await publishMqtt(config, command, async () => connection);
  assert.deepEqual(result, { outcome: "published", ack: null });
  assert.equal(connection.closed, true);
  assert.equal(connection.writes[0][0], 0x10);
  assert.equal(connection.writes[1][0], 0x32);
  const payload = new TextDecoder().decode(connection.writes[1]);
  assert.ok(payload.includes("TEST_ONLY"));
  assert.ok(payload.includes("00104"));
  assert.ok(payload.includes(command.id));
});
test("device confirmation subscribes first and requires exact command, employee, serial and kind", async () => {
  const connection = new FakeConnection({
    messages: [
      reply(ack({ request_id: "old" })),
      reply(ack({ sn: "other" })),
      reply(ack({ ret: "sendlog" })),
      reply(ack()),
    ],
  });
  assert.deepEqual(await publishMqtt({ ...config, ack: rules }, command, async () => connection), {
    outcome: "published",
    ack: true,
  });
  assert.equal(connection.writes[1][0], 0x82);
  assert.equal(connection.writes[2][0], 0x32);
});
test("retained acknowledgments are ignored and a device rejection is explicit", async () => {
  const connection = new FakeConnection({
    messages: [reply(ack(), { retained: true }), reply(ack({ ok: false }), { qos: 1 })],
  });
  assert.deepEqual(await publishMqtt({ ...config, ack: rules }, command, async () => connection), {
    outcome: "published",
    ack: false,
  });
  assert.ok(connection.writes.some((bytes) => bytes[0] === 0x40));
});
test("broker PUBACK alone leaves enrollment pending when device confirmation times out", async () => {
  const connection = new FakeConnection();
  assert.deepEqual(await publishMqtt({ ...config, ack: rules }, command, async () => connection), {
    outcome: "published",
    ack: null,
  });
  assert.equal(connection.closed, true);
});
test("uncertain publish is distinguished from safe connection failure", async () => {
  const connection = new FakeConnection({ failPublish: true });
  assert.deepEqual(await publishMqtt(config, command, async () => connection), {
    outcome: "uncertain",
    ack: null,
  });
  const rejected = new FakeConnection({ connack: false });
  assert.deepEqual(await publishMqtt(config, command, async () => rejected), {
    outcome: "not_sent",
    ack: null,
  });
  assert.equal(rejected.writes.length, 1);
  assert.equal(rejected.closed, true);
});
test("late socket connections are closed after timeout and never publish", async () => {
  const connection = new FakeConnection();
  const result = await publishMqtt(
    { ...config, timeoutMs: 10 },
    command,
    () => new Promise((resolve) => setTimeout(() => resolve(connection), 30)),
  );
  assert.equal(result.outcome, "not_sent");
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(connection.closed, true);
  assert.equal(connection.writes.length, 0);
});
test("config requires real firmware template, exact topics and acknowledgment correlation", () => {
  const env = {
    ATTENDANCE_MQTT_HOST: "test",
    ATTENDANCE_MQTT_PORT: "1883",
    ATTENDANCE_MQTT_TLS: "false",
    ATTENDANCE_MQTT_USERNAME: "user",
    ATTENDANCE_MQTT_PASSWORD: "pass",
    ATTENDANCE_MQTT_ENROLL_TEMPLATE: JSON.stringify(config.template),
    ATTENDANCE_COMMAND_TOPIC: config.topic,
    ATTENDANCE_DEVICE_ID: config.deviceId,
  };
  assert.equal(mqttConfig((name) => env[name]).port, 1883);
  assert.equal(
    mqttConfig(() => undefined),
    null,
  );
  assert.throws(
    () => mqttConfig((name) => ({ ...env, ATTENDANCE_COMMAND_TOPIC: "device/#" })[name]),
    /Exact/,
  );
  assert.throws(
    () =>
      mqttConfig(
        (name) =>
          ({
            ...env,
            ATTENDANCE_MQTT_ENROLL_TEMPLATE: '{"id":"{{enroll_id}}"}',
            ATTENDANCE_MQTT_ACK_RULES: JSON.stringify(rules),
          })[name],
      ),
    /correlation/,
  );
  assert.equal(
    renderMqttEnrollment({ id: "{{enroll_id_number}}" }, command, config.deviceId).id,
    104,
  );
});
