export interface HttpRequest { url: string; headers: Readonly<Record<string, string>>; }
export interface HttpResponse { status: number; headers: Readonly<Record<string, string>>; body: string; }
export interface HttpTransport { request(input: HttpRequest): Promise<HttpResponse>; }
export interface QuoteCache { get(requestKey: string): Promise<{ etag: string | null; body: unknown; fetchedAt: string } | null>; put(requestKey: string, value: { etag: string | null; body: unknown; fetchedAt: string }): Promise<void>; }
export interface ManualOverrideStore { get(from: string, to: string, asOf: string): Promise<{ numerator: bigint; denominator: bigint } | null>; }
