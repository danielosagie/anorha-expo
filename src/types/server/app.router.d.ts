// GENERATED from sssync-bknd src/trpc (npm run trpc:types). Do not edit by hand.
// Re-vendor when the backend router changes (or replace with a published @sssync/api pkg).
export declare const appRouter: import("@trpc/server").TRPCBuiltRouter<{
    ctx: import("./context").TrpcContext;
    meta: object;
    errorShape: import("@trpc/server").TRPCDefaultErrorShape;
    transformer: false;
}, import("@trpc/server").TRPCDecorateCreateRouterOptions<{
    health: import("@trpc/server").TRPCQueryProcedure<{
        input: void;
        output: {
            ok: boolean;
            ts: number;
        };
        meta: object;
    }>;
    me: import("@trpc/server").TRPCQueryProcedure<{
        input: void;
        output: {
            id: string;
            email: string;
        };
        meta: object;
    }>;
    echo: import("@trpc/server").TRPCMutationProcedure<{
        input: {
            message: string;
        };
        output: {
            userId: string;
            message: string;
            at: string;
        };
        meta: object;
    }>;
    jobs: import("@trpc/server").TRPCBuiltRouter<{
        ctx: import("./context").TrpcContext;
        meta: object;
        errorShape: import("@trpc/server").TRPCDefaultErrorShape;
        transformer: false;
    }, import("@trpc/server").TRPCDecorateCreateRouterOptions<{
        list: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                type?: "match" | "analysis" | "generate" | "regenerate" | undefined;
                status?: string | undefined;
                limit?: number | undefined;
            } | undefined;
            output: any[];
            meta: object;
        }>;
        get: import("@trpc/server").TRPCQueryProcedure<{
            input: {
                id: string;
            };
            output: any;
            meta: object;
        }>;
    }>>;
}>>;
export type AppRouter = typeof appRouter;
