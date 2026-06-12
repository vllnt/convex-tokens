import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type {
  MintResult,
  TokenMetadata,
  TokensOptions,
  ValidateResult,
} from "./types.js";
import {
  DEFAULT_HASH_ALGO,
  DEFAULT_MAX_TTL_MS,
  DEFAULT_SCOPE,
  DEFAULT_TOKEN_BYTES,
  DEFAULT_TTL_MS,
  generateToken,
  type HashAlgo,
  hashToken,
} from "../shared.js";

/**
 * The token component's function references, as exposed on the host via
 * `components.tokens`. The component computes `expiresAt` itself from `ttlMs` —
 * the client never sends a timestamp — and reads the current time server-side in
 * `validate`, so neither expiry nor validity can be spoofed by a client clock.
 */
export interface TokensComponent {
  mutations: {
    mint: FunctionReference<
      "mutation",
      "internal",
      {
        tokenHash: string;
        scope: string;
        resourceRef?: string;
        ttlMs: number;
        defaultTtlMs: number;
        maxTtlMs: number;
      },
      string
    >;
    revoke: FunctionReference<
      "mutation",
      "internal",
      { tokenHash: string; scope: string },
      boolean
    >;
    prune: FunctionReference<"mutation", "internal", { before: number }, number>;
  };
  queries: {
    validate: FunctionReference<
      "query",
      "internal",
      { tokenHash: string; scope: string },
      ValidateResult
    >;
    list: FunctionReference<
      "query",
      "internal",
      { scope: string; resourceRef?: string; limit?: number },
      TokenMetadata[]
    >;
    getMetadata: FunctionReference<
      "query",
      "internal",
      { id: string },
      TokenMetadata | null
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/** Options for {@link Tokens.mint}. */
export interface MintOptions {
  /** Namespace for the token. Defaults to the client's `defaultScope`. */
  scope?: string;
  /** Opaque host-owned reference to carry on the token. */
  resourceRef?: string;
  /**
   * Requested lifetime in ms. The component clamps it into
   * `[MIN_TTL_MS, maxTtlMs]` server-side; a non-finite value falls back to
   * `defaultTtlMs`. The client never computes the expiry timestamp.
   */
  ttlMs?: number;
}

/** Options for {@link Tokens.list}. */
export interface ListOptions {
  /** Namespace to list within. Defaults to the client's `defaultScope`. */
  scope?: string;
  /** Restrict to a single opaque host reference. */
  resourceRef?: string;
  /** Max rows to return. Default 100 (component-side). */
  limit?: number;
}

/**
 * Consumer-facing client for the hashed-secret token registry. The host owns
 * meaning and auth; it passes an opaque `resourceRef` and an optional `scope`.
 * The raw token is generated and hashed here — the component only ever sees the
 * hash, never the secret. Time is sourced server-side: the client never supplies
 * `now` or an `expiresAt`.
 */
export class Tokens {
  private readonly defaultScope: string;
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly tokenBytes: number;
  private readonly hashAlgo: HashAlgo;

  constructor(
    private readonly component: TokensComponent,
    options: TokensOptions = {},
  ) {
    this.defaultScope = options.defaultScope ?? DEFAULT_SCOPE;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxTtlMs = options.maxTtlMs ?? DEFAULT_MAX_TTL_MS;
    this.tokenBytes = options.tokenBytes ?? DEFAULT_TOKEN_BYTES;
    this.hashAlgo = options.hashAlgo ?? DEFAULT_HASH_ALGO;
  }

  private scopeOf(scope: string | undefined): string {
    return scope ?? this.defaultScope;
  }

  /**
   * Mint a new token. Returns the raw secret ONCE (it is never recoverable
   * afterwards) alongside the component-side id. The requested `ttlMs` is sent
   * to the component, which clamps it and computes `expiresAt` from its own
   * clock.
   */
  async mint(ctx: RunMutationCtx, opts: MintOptions = {}): Promise<MintResult> {
    const raw = generateToken(this.tokenBytes);
    const tokenHash = await hashToken(raw, this.hashAlgo);
    const id = await ctx.runMutation(this.component.mutations.mint, {
      tokenHash,
      scope: this.scopeOf(opts.scope),
      resourceRef: opts.resourceRef,
      ttlMs: opts.ttlMs ?? this.defaultTtlMs,
      defaultTtlMs: this.defaultTtlMs,
      maxTtlMs: this.maxTtlMs,
    });
    return { token: raw, id };
  }

  /**
   * Validate `rawToken`. Hashes the secret and checks scope, revocation, and
   * expiry. Expiry is evaluated against the component's server clock — there is
   * no client-supplied time to override it.
   */
  async validate(
    ctx: RunQueryCtx,
    rawToken: string,
    scope?: string,
  ): Promise<ValidateResult> {
    const tokenHash = await hashToken(rawToken, this.hashAlgo);
    return ctx.runQuery(this.component.queries.validate, {
      tokenHash,
      scope: this.scopeOf(scope),
    });
  }

  /** Revoke `rawToken`. Returns `true` if a matching token was revoked. */
  async revoke(
    ctx: RunMutationCtx,
    rawToken: string,
    scope?: string,
  ): Promise<boolean> {
    const tokenHash = await hashToken(rawToken, this.hashAlgo);
    return ctx.runMutation(this.component.mutations.revoke, {
      tokenHash,
      scope: this.scopeOf(scope),
    });
  }

  /**
   * List token METADATA (never the hash) for a management surface, filtered by
   * scope and optional `resourceRef`. Safe to expose to a future admin UI.
   */
  list(ctx: RunQueryCtx, opts: ListOptions = {}): Promise<TokenMetadata[]> {
    return ctx.runQuery(this.component.queries.list, {
      scope: this.scopeOf(opts.scope),
      resourceRef: opts.resourceRef,
      limit: opts.limit,
    });
  }

  /**
   * Fetch the safe METADATA of one token by its component id (the `id` from
   * {@link Tokens.mint}). Returns `null` if it no longer exists. Never returns
   * the hash.
   */
  getMetadata(ctx: RunQueryCtx, id: string): Promise<TokenMetadata | null> {
    return ctx.runQuery(this.component.queries.getMetadata, { id });
  }

  /** Delete every token that expired before `before` (default now). Returns the count. */
  prune(ctx: RunMutationCtx, before?: number): Promise<number> {
    return ctx.runMutation(this.component.mutations.prune, {
      before: before ?? Date.now(),
    });
  }
}

export type { MintResult, TokenMetadata, TokensOptions, ValidateResult };
