import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Crop to the visible content, not the browser canvas. The SVG viewport keeps
// original screenshot bytes and proportions while removing oversized margins.
const screenshots = [
  { name: "desk-compute-comparison", extension: "webp", title: "GPU rental price comparisons",
    size: [1922, 1040], crop: [0, 0, 1922, 1040], paper: "#181818" },
  { name: "desk-clouds-compute-comparison", extension: "png", title: "Cloud shares compared with GPU rental prices",
    size: [1750, 1054], crop: [202, 177, 1320, 743], paper: "#fcfdf9" },
  { name: "desk-gallery-sidebar-light", extension: "png", title: "Desk gallery",
    size: [2928, 1524], crop: [672, 108, 2176, 1224], paper: "#fefefe" },
  { name: "desk-h100-depth-history-monitor", extension: "png", title: "H100 market depth in Monitor",
    size: [2908, 1456], crop: [772, 128, 1952, 1098], paper: "#1f1f1f" },
];

const assets = new URL("../assets/showcase/", import.meta.url);

for (const { name, extension, title, size, crop, paper } of screenshots) {
  const source = await readFile(new URL(`${name}.${extension}`, assets));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img">
  <title>${title}</title>
  <rect width="1600" height="900" fill="${paper}"/>
  <svg width="1600" height="900" viewBox="${crop.join(" ")}" preserveAspectRatio="xMidYMid meet" overflow="hidden">
    <image width="${size[0]}" height="${size[1]}" href="data:image/${extension};base64,${source.toString("base64")}"/>
  </svg>
</svg>
`;
  const revision = createHash("sha256").update(svg).digest("hex").slice(0, 12);
  const filename = `${name}-frame-${revision}.svg`;
  await writeFile(new URL(filename, assets), svg);
  console.log(`assets/showcase/${filename}`);
}

console.log("Built four content-cropped README tiles.");
