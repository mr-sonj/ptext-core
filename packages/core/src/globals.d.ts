// Minimal Web-standard APIs available in browsers, Workers, Node ≥18, Deno, Bun.
// Declared here so core compiles WITHOUT the DOM lib (prevents accidental DOM use).
declare function btoa(data: string): string;
declare function atob(data: string): string;
declare function setTimeout(handler: () => void, ms?: number): unknown;
declare function clearTimeout(id: unknown): void;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}
interface AbortSignal {
  readonly aborted: boolean;
}
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}
