import { Controller, Headers, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { DepositsService } from "./deposits.service";

@Controller("deposits")
export class DepositsController {
  constructor(
    private readonly deposits: DepositsService,
    private readonly auth: AuthService,
  ) {}

  @Post("scan")
  async scan(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.deposits.scanAssignedWallets();
  }
}