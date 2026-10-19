// Local type-check adapter for the hosted, pinned aws4fetch import.
declare module "https://esm.sh/aws4fetch@1.0.20" {
  export class AwsClient {
    constructor(options: {
      accessKeyId: string;
      secretAccessKey: string;
      service: string;
      region: string;
    });
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
    sign(input: Request, options: { aws: { signQuery: boolean } }): Promise<Request>;
  }
}
