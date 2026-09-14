#!/usr/bin/env node
import { doctor } from "../src/lib/doctor.mjs";

const result = await doctor();
console.log(JSON.stringify(result, null, 2));
process.exit(Object.values(result.commands).every((item) => item.available) ? 0 : 1);
