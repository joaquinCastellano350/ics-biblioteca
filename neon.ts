import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault || branch.name === "production" || branch.name === "development") {
      // Permanent environments: do not assign an expiration when creating them.
      return {};
    }
    if (!branch.exists) {
      // New temporary branches: expire after 30 days, the maximum supported TTL.
      return { ttl: "30d" };
    }
    // Existing branch: preserve its settings, including any expiration already set.
    return {};
  },
});
