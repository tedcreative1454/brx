import { Controller, Post } from "@nestjs/common";
import { DepositsService } from "./deposits.service";

@Controller("deposits")
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Post("scan")
  scan() {
    return this.deposits.scanAssignedWallets();
  }
}

