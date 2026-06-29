// One-off generator for the 1024px maskable PWA icon.
//
// Why this exists: Chrome on macOS uses the manifest's `maskable` icon (not the
// `any` icon) to render the installed app's dock/Launchpad icon, and the dock
// tile is drawn at up to 1024px on Retina. The original maskable was only 512px,
// so macOS upscaled it 2x -> blurry. This renders the master mark at 1024 with a
// full-bleed background (no rounded corners; the OS applies its own squircle).
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024" role="img" aria-label="Progress">
  <rect width="100" height="100" fill="#f5efe0"/>
  <g fill="none" stroke-linecap="round" stroke-width="9">
    <path d="M22,76 C42,73 60,73 80,75" stroke="#566039"/>
    <path d="M26,62 C44,59 62,60 78,62" stroke="#79864c"/>
    <path d="M30,48 C46,45 62,46 74,48" stroke="#bb6f50"/>
    <path d="M34,35 C46,33 56,33 66,35" stroke="#d89572"/>
  </g>
</svg>`;

const png = await sharp(Buffer.from(svg)).resize(1024, 1024).png().toBuffer();
for (const dir of ["public/brand-assets", "brand-assets"]) {
  await writeFile(`${dir}/icon-1024-maskable.png`, png);
  console.log(`wrote ${dir}/icon-1024-maskable.png (${png.length} bytes)`);
}
await writeFile("brand-assets/progress-icon-maskable.svg", svg);
console.log("wrote brand-assets/progress-icon-maskable.svg");
