#!/usr/bin/env node
/**
 * Production deploys moved to the homelab repo, which owns the host, the
 * sealed .env and the Traefik config. This stub stays so `npm run deploy`
 * says where to go instead of SSHing to a machine that no longer serves the site.
 */

console.error(
  [
    "Deploys are run from the homelab repo, not from here:",
    "",
    "  node cli/homelab.js deploy wedding              # plan only — read it",
    "  node cli/homelab.js deploy wedding --apply --yes",
    "",
    "It deploys origin/main, so push main first.",
  ].join("\n"),
)
process.exit(1)
