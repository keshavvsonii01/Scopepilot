/**
 * Operator CLI: move records created under a legacy development workspace (pre-authentication) into
 * a registered user's personal workspace. Dry run unless --apply is given.
 *
 *   pnpm --filter @scopepilot/api claim-dev-data                       # list legacy workspaces
 *   pnpm --filter @scopepilot/api claim-dev-data -- --email you@x.com  # dry run
 *   pnpm --filter @scopepilot/api claim-dev-data -- --email you@x.com --apply
 */
import { connectDatabase } from "@scopepilot/persistence/audits";
import { findCredentials, findPersonalWorkspace } from "@scopepilot/persistence/auth";
import { configureMongoDns } from "@scopepilot/persistence/dns";
import { claimLegacyWorkspaceData, listLegacyWorkspaceIds } from "@scopepilot/persistence/migration";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { normalizeEmail } from "@scopepilot/contracts/auth";
import { loadApiEnvironment } from "./env.js";

export const DEFAULT_LEGACY_WORKSPACE = "local-development-workspace";

export interface ClaimArgs {
  email?: string;
  from: string;
  apply: boolean;
  allowProduction: boolean;
}

export function parseClaimArgs(argv: readonly string[]): ClaimArgs {
  const args: ClaimArgs = { from: DEFAULT_LEGACY_WORKSPACE, apply: false, allowProduction: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--apply") args.apply = true;
    else if (arg === "--allow-production") args.allowProduction = true;
    else if (arg === "--email" || arg === "--from") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--email") args.email = normalizeEmail(value);
      else args.from = value.trim();
      index += 1;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseClaimArgs(process.argv.slice(2));
  const environment = loadApiEnvironment();
  if (environment.session.production && !args.allowProduction) throw new Error("Refusing to run with NODE_ENV=production. Pass --allow-production if this is intentional.");
  configureMongoDns(environment.mongoDnsServers);
  await connectDatabase(environment.mongoUri);
  try {
    if (!args.email) {
      const legacy = await listLegacyWorkspaceIds();
      console.log(Object.keys(legacy).length ? "Legacy workspace IDs with records:" : "No legacy workspace records found.");
      for (const [id, count] of Object.entries(legacy)) console.log(`  ${id}: ${count} record(s)`);
      console.log("Re-run with --email <registered user> to preview a claim, then add --apply.");
      return;
    }
    const credentials = await findCredentials(args.email);
    const workspace = credentials ? await findPersonalWorkspace(credentials.user.id) : null;
    if (!credentials || !workspace) throw new Error("No registered user with a personal workspace matches that email.");
    const plan = await claimLegacyWorkspaceData({ fromWorkspaceId: args.from, toWorkspaceId: workspace.id, apply: args.apply });
    console.log(`${plan.applied ? "Moved" : "Would move"} from "${plan.fromWorkspaceId}" to the personal workspace of ${args.email}:`);
    for (const [collection, count] of Object.entries(plan.counts)) console.log(`  ${collection}: ${count}`);
    if (!plan.applied) console.log("Dry run only. Add --apply to make these changes.");
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
