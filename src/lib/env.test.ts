import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, isSupabaseConfigured, isResumeParsingConfigured } from "@/lib/env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "OPENAI_API_KEY",
];

describe("env access", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("throws a clear error when a required var is missing", () => {
    expect(() => env.supabaseUrl()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => env.supabaseKey()).toThrowError(/PUBLISHABLE_KEY/);
  });

  it("returns the value when present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    expect(env.supabaseUrl()).toBe("https://x.supabase.co");
  });

  it("defaults the site URL to localhost", () => {
    expect(env.siteUrl()).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.shugulika.africa";
    expect(env.siteUrl()).toBe("https://app.shugulika.africa");
  });

  it("reports configuration state", () => {
    expect(isSupabaseConfigured()).toBe(false);
    expect(isResumeParsingConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isSupabaseConfigured()).toBe(true);
    expect(isResumeParsingConfigured()).toBe(true);
  });

  it("defaults the resume model but never treats it as public", () => {
    expect(env.openaiResumeModel()).toBe("gpt-4.1-mini");
  });
});
