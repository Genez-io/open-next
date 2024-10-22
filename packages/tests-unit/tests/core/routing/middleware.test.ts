import { handleMiddleware } from "@opennextjs/aws/core/routing/middleware.js";
import { convertFromQueryString } from "@opennextjs/aws/core/routing/util.js";
import { InternalEvent } from "@opennextjs/aws/types/open-next.js";
import { toReadableStream } from "@opennextjs/aws/utils/stream.js";
import { vi } from "vitest";

vi.mock("@opennextjs/aws/adapters/config/index.js", () => ({
  NextConfig: {},
  MiddlewareManifest: {
    sortedMiddleware: ["/"],
    middleware: {
      "/": {
        files: [
          "prerender-manifest.js",
          "server/edge-runtime-webpack.js",
          "server/middleware.js",
        ],
        name: "middleware",
        page: "/",
        matchers: [
          {
            regexp:
              "^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next|favicon.ico|match|static|fonts|api\\/auth|og).*))(.json)?[\\/#\\?]?$",
            originalSource:
              "/((?!_next|favicon.ico|match|static|fonts|api/auth|og).*)",
          },
        ],
        wasm: [],
        assets: [],
      },
    },
    functions: {},
    version: 2,
  },
}));

vi.mock("@opennextjs/aws/core/routing/i18n/index.js", () => ({
  localizePath: (event: InternalEvent) => event.rawPath,
}));

const middleware = vi.fn();
const middlewareLoader = vi.fn().mockResolvedValue({
  default: middleware,
});

type PartialEvent = Partial<
  Omit<InternalEvent, "body" | "rawPath" | "query">
> & { body?: string };

function createEvent(event: PartialEvent): InternalEvent {
  const [rawPath, qs] = (event.url ?? "/").split("?", 2);
  return {
    type: "core",
    method: event.method ?? "GET",
    rawPath,
    url: event.url ?? "/",
    body: Buffer.from(event.body ?? ""),
    headers: event.headers ?? {},
    query: convertFromQueryString(qs ?? ""),
    cookies: event.cookies ?? {},
    remoteAddress: event.remoteAddress ?? "::1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Ideally these tests would be broken up and tests smaller parts of the middleware rather than the entire function.
 */
describe("handleMiddleware", () => {
  it("should bypass middlware for internal requests", async () => {
    const event = createEvent({
      headers: {
        "x-isr": "1",
      },
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).not.toBeCalled();
    expect(result).toEqual(event);
  });

  it("should invoke middlware with redirect", async () => {
    const event = createEvent({});
    middleware.mockResolvedValue({
      status: 302,
      headers: new Headers({
        location: "/redirect",
      }),
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result.statusCode).toEqual(302);
    expect(result.headers.location).toEqual("/redirect");
  });

  it("should invoke middlware with external redirect", async () => {
    const event = createEvent({});
    middleware.mockResolvedValue({
      status: 302,
      headers: new Headers({
        location: "http://external/redirect",
      }),
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result.statusCode).toEqual(302);
    expect(result.headers.location).toEqual("http://external/redirect");
  });

  it("should invoke middlware with rewrite", async () => {
    const event = createEvent({
      headers: {
        host: "localhost",
      },
    });
    middleware.mockResolvedValue({
      headers: new Headers({
        "x-middleware-rewrite": "http://localhost/rewrite",
      }),
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result).toEqual({
      ...event,
      rawPath: "/rewrite",
      url: "/rewrite",
      responseHeaders: {
        "x-middleware-rewrite": "http://localhost/rewrite",
      },
      externalRewrite: false,
    });
  });

  it("should invoke middlware with rewrite with __nextDataReq", async () => {
    const event = createEvent({
      url: "/rewrite?__nextDataReq=1&key=value",
      headers: {
        host: "localhost",
      },
    });
    middleware.mockResolvedValue({
      headers: new Headers({
        "x-middleware-rewrite": "http://localhost/rewrite?newKey=value",
      }),
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result).toEqual({
      ...event,
      rawPath: "/rewrite",
      url: "/rewrite",
      responseHeaders: {
        "x-middleware-rewrite": "http://localhost/rewrite?newKey=value",
      },
      query: {
        __nextDataReq: "1",
        newKey: "value",
      },
      externalRewrite: false,
    });
  });

  it("should invoke middlware with external rewrite", async () => {
    const event = createEvent({
      headers: {
        host: "localhost",
      },
    });
    middleware.mockResolvedValue({
      headers: new Headers({
        "x-middleware-rewrite": "http://external/rewrite",
      }),
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result).toEqual({
      ...event,
      rawPath: "http://external/rewrite",
      url: "http://external/rewrite",
      responseHeaders: {
        "x-middleware-rewrite": "http://external/rewrite",
      },
      externalRewrite: true,
    });
  });

  it("should map x-middleware-request- headers as request headers", async () => {
    const event = createEvent({});
    middleware.mockResolvedValue({
      headers: new Headers({
        "x-middleware-request-custom-header": "value",
      }),
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result).toEqual({
      ...event,
      headers: {
        "custom-header": "value",
      },
      responseHeaders: {},
      externalRewrite: false,
    });
  });

  it("should return a response from middleware", async () => {
    const event = createEvent({});
    const body = toReadableStream("Hello, world!");

    middleware.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body,
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result).toEqual({
      type: "core",
      statusCode: 200,
      headers: {},
      body,
      isBase64Encoded: false,
    });
  });

  it("should return a response from middleware with set-cookie header", async () => {
    const event = createEvent({});
    const body = toReadableStream("Hello, world!");

    middleware.mockResolvedValue({
      status: 200,
      headers: new Headers({
        "set-cookie": "cookie=value",
      }),
      body,
    });
    const result = await handleMiddleware(event, middlewareLoader);

    expect(middlewareLoader).toBeCalled();
    expect(result).toEqual({
      type: "core",
      statusCode: 200,
      headers: {
        "set-cookie": ["cookie=value"],
      },
      body,
      isBase64Encoded: false,
    });
  });
});