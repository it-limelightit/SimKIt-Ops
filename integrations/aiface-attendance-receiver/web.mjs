import { createHealthServer } from "./health-server.mjs";

const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const server = createHealthServer();
server.listen(port, "0.0.0.0", () =>
  console.log(`Attendance health endpoint listening on port ${port}.`),
);
try {
  await import("./receiver.mjs");
} catch {
  console.error("Attendance receiver startup failed; check its required environment variables.");
  server.close();
  process.exitCode = 1;
}
process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
