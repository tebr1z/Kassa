import type { NextConfig } from "next";

const nextConfig: NextConfig = {
 output:"standalone",
 // Resolve canonical/robots before HTML starts, including missing-product 404s.
 htmlLimitedBots: /.*/,
 outputFileTracingExcludes:{"/*":[
  "./.private/**/*","./.env*","./.local-data/**/*","./.local-desktop-data/**/*",
  "./.public-media/**/*","./web-release/**/*","./desktop/vendor/**/*",
  "./desktop-release/**/*","./dist/**/*","./outputs/**/*","./work/**/*",
  "./.sites-runtime/**/*","./.git/**/*","./.agents/**/*","./.codex/**/*",
 ]},
 experimental: { cpus: 2 },
};

export default nextConfig;
