declare module 'hpp' {
  import type { RequestHandler } from 'express';

  export interface HppOptions {
    checkBody?: boolean;
    checkQuery?: boolean;
    checkBodyOnlyForContentType?: string[];
    whitelist?: string[];
  }

  const hpp: (options?: HppOptions) => RequestHandler;
  export default hpp;
}
