import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableCors({
    origin: [env.frontendUrl, "http://localhost:5173", "http://127.0.0.1:5173", "null"],
    credentials: true,
  });
  app.setGlobalPrefix("api");
  await app.listen(env.port);
}

void bootstrap();
