import { readFile, writeFile } from "node:fs/promises";

// GitHub strips object-fit from README HTML. SVG frames contain the original
// screenshots at a shared ratio without cropping or resampling the source files.
const screenshots = [
  ["desk-compute-comparison", "webp", "GPU rental price comparisons"],
  ["desk-clouds-compute-comparison", "png", "Cloud shares compared with GPU rental prices"],
  ["desk-gallery-sidebar-light", "png", "Desk gallery with the sidebar open"],
  ["desk-h100-depth-history-monitor", "png", "H100 market depth in Monitor"],
];

const assets = new URL("../assets/showcase/", import.meta.url);

for (const [name, extension, title] of screenshots) {
  const source = await readFile(new URL(`${name}.${extension}`, assets));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img">
  <title>${title}</title>
  <image width="1600" height="900" preserveAspectRatio="xMidYMid meet" href="data:image/${extension};base64,${source.toString("base64")}"/>
</svg>
`;
  await writeFile(new URL(`${name}-frame.svg`, assets), svg);
}

console.log("Built four matching 16:9 README frames.");
