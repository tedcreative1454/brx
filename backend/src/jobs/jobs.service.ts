import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../config/env";

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly redis = new Redis(env.redisUrl, { lazyConnect: true });

  async enqueue(queue: string, payload: unknown) {
    if (this.redis.status === "wait" || this.redis.status === "end") {
      await this.redis.connect();
    }

    await this.redis.lpush(`queue:${queue}`, JSON.stringify({ payload, createdAt: new Date().toISOString() }));
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}

