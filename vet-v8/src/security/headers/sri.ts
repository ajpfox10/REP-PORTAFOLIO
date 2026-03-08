/**
 * Subresource Integrity (SRI) helper — v10  (S-12)
 *
 * Any script/link loaded from an external CDN must include an integrity
 * attribute so the browser verifies the file wasn't tampered with.
 *
 * Usage in SSR/template layer:
 *   const tag = sriScriptTag("https://cdnjs.cloudflare.com/.../lodash.min.js", "sha384-...");
 *
 * To generate the hash for a new asset:
 *   node -e "
 *     const {createHash} = require('crypto');
 *     const {readFileSync} = require('fs');
 *     const b = readFileSync('lodash.min.js');
 *     console.log('sha384-' + createHash('sha384').update(b).digest('base64'));
 *   "
 *
 * Or use: https://www.srihash.org/
 *
 * Known external assets used by this platform (update hashes on version bumps):
 */

export type SriAsset = {
  url:       string;
  integrity: string;
  crossorigin?: "anonymous" | "use-credentials";
};

/**
 * Registry of all external assets loaded by the frontend.
 * IMPORTANT: Update integrity hash every time a CDN asset version changes.
 * CI will fail if a hash doesn't match (CSP + SRI double protection).
 */
export const EXTERNAL_ASSETS: SriAsset[] = [
  // Example entries — replace with actual assets used by the frontend:
  // {
  //   url: "https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js",
  //   integrity: "sha512-WFN04846sdKMIP5LKNphMaWzU7YpMyCU245etK3g/2ARYbPK9Ub18eG+ljU96qKRCWh+olmkgo0PaVS9Ks0A4A==",
  //   crossorigin: "anonymous",
  // },
];

/** Generate a <script> tag with SRI integrity attribute. */
export function sriScriptTag(asset: SriAsset): string {
  const co = asset.crossorigin ?? "anonymous";
  return `<script src="${esc(asset.url)}" integrity="${esc(asset.integrity)}" crossorigin="${co}" defer></script>`;
}

/** Generate a <link rel="stylesheet"> tag with SRI integrity attribute. */
export function sriStyleTag(asset: SriAsset): string {
  const co = asset.crossorigin ?? "anonymous";
  return `<link rel="stylesheet" href="${esc(asset.url)}" integrity="${esc(asset.integrity)}" crossorigin="${co}">`;
}

/** Verify that all registered assets have integrity hashes (call at startup). */
export function validateSriRegistry(): void {
  const missing = EXTERNAL_ASSETS.filter(a => !a.integrity?.startsWith("sha"));
  if (missing.length > 0) {
    throw new Error(
      `[SRI] Missing integrity hashes for: ${missing.map(a => a.url).join(", ")}\n` +
      "Run scripts/generate-sri.ts to generate hashes."
    );
  }
}

function esc(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
