// GENERATED from sssync-bknd src/trpc/context.ts. Do not edit by hand.
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
export interface TrpcUser {
    id: string;
    email: string;
}
export interface TrpcContext {
    user: TrpcUser | null;
}
export declare function createContext({ req }: CreateExpressContextOptions): TrpcContext;
