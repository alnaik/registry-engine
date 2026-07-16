import type { DriverRegistry } from "../driver.js";
import { SocrataDriver } from "./socrata.js";
import { StaticShardDriver } from "./staticShard.js";

// "rest" has no v3.0 consumer (PACA turned out CORS-blocked and ships as a
// static shard) — the kind stays valid in the manifest schema, the driver
// arrives with its first real source.
export const defaultDrivers: DriverRegistry = {
  socrata: new SocrataDriver(),
  static_shard: new StaticShardDriver(),
};

export { SocrataDriver, soqlSafeLiteral } from "./socrata.js";
export { StaticShardDriver } from "./staticShard.js";
export { rowToEntity } from "./mapRow.js";
