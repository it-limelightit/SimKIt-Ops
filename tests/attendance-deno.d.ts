// Only for local checks of hosted Edge Function code; production uses Deno types.
declare namespace Deno {
  interface Conn {
    read(buffer: Uint8Array): Promise<number | null>;
    write(buffer: Uint8Array): Promise<number>;
    close(): void;
  }
  function connect(options: { hostname: string; port: number; transport: "tcp" }): Promise<Conn>;
  function connectTls(options: { hostname: string; port: number }): Promise<Conn>;
  namespace env {
    function get(name: string): string | undefined;
  }
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}
