import type { DriverRegistry } from "../driver.js";
import { SocrataDriver } from "./socrata.js";
import { StaticShardDriver } from "./staticShard.js";
import { EchoDriver } from "./echo.js";

// "rest" still has no consumer (PACA and PPP ship as static shards, EPA ECHO
// has its own two-step driver) — the kind stays valid in the manifest schema,
// the generic driver arrives with its first real source.
export const defaultDrivers: DriverRegistry = {
  socrata: new SocrataDriver(),
  static_shard: new StaticShardDriver(),
  echo: new EchoDriver(),
};

export { SocrataDriver, soqlSafeLiteral } from "./socrata.js";
export { StaticShardDriver } from "./staticShard.js";
export { EchoDriver } from "./echo.js";
export { rowToEntity } from "./mapRow.js";
