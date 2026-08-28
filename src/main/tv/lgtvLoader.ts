import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type LGTVType from "lgtv2";

/**
 * lgtv2 v2 is an ESM-only package while the Electron main bundle is CommonJS.
 * The indirection through `new Function` keeps the bundler from rewriting this
 * dynamic import into a `require`, which would throw ERR_REQUIRE_ESM.
 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

type LGTVConstructor = typeof LGTVType;

let cached: Promise<LGTVConstructor> | null = null;

/**
 * Resolve lgtv2 to an absolute file URL first. A bare specifier inside
 * `new Function` would be resolved against the process working directory, which
 * is not the app directory once the application is packaged.
 */
function resolveSpecifier(): string {
  try {
    const require = createRequire(__filename);
    return pathToFileURL(require.resolve("lgtv2")).href;
  } catch {
    return "lgtv2";
  }
}

export function loadLgtv(): Promise<LGTVConstructor> {
  if (!cached) {
    cached = dynamicImport(resolveSpecifier()).then(
      (mod) => (mod.default ?? mod.LGTV) as LGTVConstructor,
    );
  }
  return cached;
}
