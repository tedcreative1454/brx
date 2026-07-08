import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 12 * 1024 * 1024 }),
  );
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("preHandler", (request, _reply, done) => {
    if (!request.headers.authorization) {
      const token = authCookieToken(request.headers.cookie);
      if (token) request.headers.authorization = `Bearer ${token}`;
    }
    done();
  });

  const allowedOrigins = env.nodeEnv === "production"
    ? [env.frontendUrl]
    : [env.frontendUrl, "http://localhost:5173", "http://127.0.0.1:5173", "null"];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
  });
  app.setGlobalPrefix("api");
  await app.listen(env.port, "0.0.0.0");
}

function authCookieToken(cookieHeader: unknown) {
  const cookie = String(cookieHeader ?? "");
  const pair = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("brx_access="));
  if (!pair) return "";
  try {
    return decodeURIComponent(pair.slice("brx_access=".length));
  } catch {
    return "";
  }
}

void bootstrap();