import { log } from "node:console";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDistribution } from "./assert-distribution.mjs";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

await assertDistribution(desktopRoot);
log("Desktop distribution smoke gate passed.");
