import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Internal cron that sweeps expired and stale-revoked tokens daily. The cadence
 * is fixed at the component layer (Convex crons are static); a mount that needs
 * a different sweep frequency can also call `prune` from its own schedule. The
 * sweep is bounded + self-rescheduling, so a daily tick safely drains any
 * backlog. See `pruneExpired` in `mutations.ts`.
 */
const crons = cronJobs();

crons.interval(
  "tokens: prune expired and stale-revoked",
  { hours: 24 },
  internal.mutations.pruneExpired,
);

export default crons;
