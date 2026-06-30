import { Global, Module } from "@nestjs/common";
import { BscService } from "./bsc.service";

@Global()
@Module({
  providers: [BscService],
  exports: [BscService],
})
export class BlockchainModule {}

