import type { NextConfig } from "next";

const nextConfig: NextConfig = {
 output:"standalone",
 // Product detail URLs end in '/', while API/admin URLs retain their existing
 // slashless paths. Proxy + the product page apply this mixed canonical policy.
 skipTrailingSlashRedirect:true,
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
