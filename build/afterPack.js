"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

/**
 * Ad-hoc sign unsigned macOS builds.
 *
 * electron-builder skips code signing entirely when no certificate is
 * configured — it does not fall back to an ad-hoc signature. macOS refuses to
 * launch an arm64 bundle that carries no signature at all, so the CI-produced
 * Apple Silicon builds would be dead on arrival. Signing with the ad-hoc
 * identity ("-") costs nothing, needs no certificate, and leaves the app
 * runnable once the user clears the quarantine flag.
 *
 * Skipped when a real certificate is in play: electron-builder signs properly a
 * few steps later and would overwrite this anyway.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.platform !== "darwin") return; // codesign exists only on macOS
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  console.log(`  • ad-hoc signed  ${app}`);
};
