import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import React from "react";

afterEach(() => cleanup());

// next/navigation — components use these; provide inert defaults tests can spy on.
const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/",
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// next/image — render a plain <img> so component tests don't need the loader.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}));

export { routerMock };
