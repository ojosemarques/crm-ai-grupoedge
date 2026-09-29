import type { Page } from "@playwright/test";

type RequestOptions = Readonly<{ data?: unknown }>;

class BrowserResponse {
  constructor(
    private readonly responseStatus: number,
    private readonly responseBody: string,
  ) {}

  ok(): boolean {
    return this.responseStatus >= 200 && this.responseStatus < 300;
  }

  status(): number {
    return this.responseStatus;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.responseBody) as unknown;
  }
}

async function send(
  page: Page,
  method: "GET" | "POST",
  url: string,
  options?: RequestOptions,
): Promise<BrowserResponse> {
  const result = await page.evaluate(async ({ method, url, data }) => {
    const response = await fetch(url, {
      method,
      ...(data === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }),
      cache: "no-store",
    });
    return { status: response.status, body: await response.text() };
  }, { method, url, data: options?.data });
  return new BrowserResponse(result.status, result.body);
}

export function browserRequest(page: Page) {
  return Object.freeze({
    get: (url: string) => send(page, "GET", url),
    post: (url: string, options?: RequestOptions) => send(page, "POST", url, options),
  });
}
