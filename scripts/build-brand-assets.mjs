// Build browser/export variants from the transparent logo; retain image copy.png as the original.
import { readFile, writeFile } from "node:fs/promises";

const original = await readFile(new URL("../public/brand/simkit-mark.png", import.meta.url));

const image = `data:image/png;base64,${original.toString("base64")}`;
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 447 447"><title>SimKit Ops</title><image href="${image}" width="447" height="447"/></svg>`;
for (const path of ["favicon.svg", "brand/simkit-mark-light.svg", "brand/simkit-mark-dark.svg"]) {
  await writeFile(new URL(`../public/${path}`, import.meta.url), mark);
}
for (const [theme, text, secondary] of [
  ["light", "#0F172A", "#475569"],
  ["dark", "#F0ECE3", "#8B8799"],
]) {
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 310 84"><title>SimKit Ops by Limelight IT</title><image href="${image}" x="0" y="5" width="74" height="74"/><g font-family="Inter,Arial,sans-serif"><text x="80" y="48" fill="${text}" font-size="44" letter-spacing="-2" font-weight="750">simkit<tspan dx="7" fill="${secondary}" font-size="27" letter-spacing="-1" font-weight="400">ops</tspan></text><text x="82" y="69" fill="${secondary}" font-size="9" letter-spacing="3" font-weight="600">LIMELIGHT <tspan fill="#159FD0" font-weight="800">IT</tspan></text></g></svg>`;
  await writeFile(new URL(`../public/brand/simkit-logo-${theme}.svg`, import.meta.url), logo);
}
