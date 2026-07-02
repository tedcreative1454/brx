import { Controller, Get } from "@nestjs/common";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async health() {
    let database = "offline";
    try {
      await this.db.query("SELECT 1");
      database = "online";
    } catch {
      database = "offline";
    }

    return {
      ok: database === "online",
      service: "brx-backend",
      environment: env.nodeEnv,
      domain: env.publicDomain,
      network: "BSC-BEP20",
      database,
    };
  }
}
