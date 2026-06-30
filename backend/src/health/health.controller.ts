import { Controller, Get } from "@nestjs/common";
import { env } from "../config/env";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      ok: true,
      service: "brx-backend",
      environment: env.nodeEnv,
      domain: env.publicDomain,
      network: "BSC-BEP20",
    };
  }
}

