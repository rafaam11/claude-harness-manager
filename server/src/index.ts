import Fastify from "fastify";
import { HOST, PORT } from "./config.js";
import { registerRoutes } from "./routes/index.js";

const app = Fastify({ logger: { level: "info" } });

// DNS rebinding 방어: 로컬 origin만 허용. CORS 헤더는 일부러 내보내지 않는다.
app.addHook("onRequest", async (req, reply) => {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return reply.code(403).send({ error: "forbidden host" });
  }
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  reply.code(err.statusCode ?? 500).send({ error: err.message });
});

await registerRoutes(app);

await app.listen({ host: HOST, port: PORT });
console.log(`claude-harness-manager server: http://${HOST}:${PORT}`);
