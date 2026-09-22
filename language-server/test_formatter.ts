/**
 * Quick manual test — run with:
 *   npx ts-node test_formatter.ts
 */
import * as fs from "fs";
import { formatASSource } from "./src/as_formatter";

const inputPath = process.argv[2] ?? "d:/MainDev/Main/Script/AI/AS_BTD_CheckAngleToEngagedActor.as";
const source = fs.readFileSync(inputPath, "utf-8");
const result = formatASSource(source);
console.log(result);
