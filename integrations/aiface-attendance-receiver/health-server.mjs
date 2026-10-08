import { createServer } from "node:http";

// Public liveness endpoint: no credentials, employee data or MQTT controls are exposed.
export function createHealthServer() {
  return createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    if (request.url !== "/" && request.url !== "/health") {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ service: "simkit-aiface-attendance", status: "running" }));
  });
}
