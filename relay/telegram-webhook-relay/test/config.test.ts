import { resolveAllowlistFromEnv } from "../src/config";

describe("resolveAllowlistFromEnv", () => {
  it("allow all when ALLOWED_USER_IDS is unset or empty", () => {
    expect(resolveAllowlistFromEnv({})).toEqual({ allowAllUsers: true, allowedUserIds: new Set() });
    expect(resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "" })).toEqual({
      allowAllUsers: true,
      allowedUserIds: new Set(),
    });
  });

  it("allow all for ALLOW_ALL_USERS, *, or REPLACE_ME", () => {
    expect(resolveAllowlistFromEnv({ ALLOW_ALL_USERS: "true" }).allowAllUsers).toBe(true);
    expect(resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "*" }).allowAllUsers).toBe(true);
    expect(resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "REPLACE_ME" }).allowAllUsers).toBe(true);
  });

  it("allowlists numeric ids when set", () => {
    const result = resolveAllowlistFromEnv({ ALLOWED_USER_IDS: "1001, 1002" });
    expect(result.allowAllUsers).toBe(false);
    expect(result.allowedUserIds).toEqual(new Set([1001, 1002]));
  });
});