// The second half of `yarn build`, after tsc: writes dist/preload.cjs.
import fs from "node:fs/promises";
import { bundlePreload } from "./bundle.js";

await fs.mkdir("dist", { recursive: true });
await fs.writeFile("dist/preload.cjs", await bundlePreload());
