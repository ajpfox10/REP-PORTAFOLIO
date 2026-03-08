/**
 * JTI Blocklist — v10  (S-02)
 *
 * Solves the logout gap: access tokens (15 min TTL) remain cryptographically
 * valid after logout because only the Redis session key is deleted. An attacker
 * who captures a token before logout can reuse it for up to 15 minutes.
 *
 * Solution: on logout, write the JTI to Redis with TTL = remaining token lifetime.
 * authMiddleware checks the blocklist on every authenticated request (1 extra
 * Redis GET, ~0.3 ms on local Redis).
 *
 * Key format:  jti:deny:<jti>   → "1"   TTL = seconds until token expiry
 *
 * Usage:
 *   // On logout:
 *   await jtiBlocklist.revoke(redis, payload.jti, payload.exp);
 *
 *   // In authMiddleware (already integrated):
 *   await jtiBlocklist.isRevoked(redis, payload.jti)  → true/false
 */

export const jtiBlocklist = {
  /**
   * Revoke a JTI. TTL is set to (exp - now) so the key auto-expires
   * exactly when the token would have expired anyway — no Redis bloat.
   */
  async revoke(redis: any, jti: string, exp: number): Promise<void> {
    const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
    await redis.set(`jti:deny:${jti}`, "1", "EX", ttl);
  },

  /** Returns true if the JTI has been explicitly revoked (logout, force-logout). */
  async isRevoked(redis: any, jti: string): Promise<boolean> {
    const val = await redis.get(`jti:deny:${jti}`);
    return val === "1";
  },
};
