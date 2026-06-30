import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { DepositsService } from "../deposits/deposits.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const deposits = app.get(DepositsService);
    const result = await deposits.scanAssignedWallets();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void run();
