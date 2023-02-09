import { FastifyInstance, FastifyReply } from 'fastify'
import { MercuriusContext, MercuriusPlugin, MercuriusOptions, PreExecutionHookResponse } from 'mercurius'
import { IncomingHttpHeaders, OutgoingHttpHeaders } from "http"

import {
  DocumentNode,
  GraphQLSchema,
  ExecutionResult,
} from "graphql";

interface ServiceConfig {
  setSchema: (schema: string) => ServiceConfig;
}

interface Gateway {
  refresh: (isRetry?: boolean) => Promise<GraphQLSchema | null>;
  serviceMap: Record<string, ServiceConfig>;

  /**
   * `preGatewayExecution` is the hook to be executed in the GraphQL gateway request lifecycle.
   * The previous hook was `preExecution`, the next hook will be `onResolution`.
   * Notice: in the `preGatewayExecution` hook, you can modify the following items by returning them in the hook definition:
   *  - `document`
   *  - `errors`
   * Each hook definition will trigger multiple times in a single request just before executing remote GraphQL queries on the federated services.
   */
  addHook<TContext = MercuriusContext, TError extends Error = Error>(name: 'preGatewayExecution', hook: preGatewayExecutionHookHandler<TContext, TError>): void;

  /**
   * `preGatewaySubscriptionExecution` is the hook to be executed in the GraphQL gateway subscription lifecycle.
   * The previous hook was `preSubscriptionExecution`, the next hook will be `onSubscriptionResolution`.
   */
  addHook<TContext = MercuriusContext>(name: 'preGatewaySubscriptionExecution', hook: preGatewaySubscriptionExecutionHookHandler<TContext>): void;

  /**
   * `onGatewayReplaceSchema` is an application lifecycle hook. When the Gateway service obtains new versions of federated schemas within a defined polling interval, the `onGatewayReplaceSchema` hook will be triggered every time a new schema is built. It is called just before the old schema is replaced with the new one.
   * This hook will only be triggered in gateway mode. It has the following parameters:
   *  - `instance` - The gateway server `FastifyInstance` (this contains the old schema).
   *  - `schema` - The new schema that has been built from the gateway refresh.
   */
  addHook(name: 'onGatewayReplaceSchema', hook: onGatewayReplaceSchemaHookHandler): void;
}

declare module "fastify" {
  interface FastifyInstance {
    /**
     * GraphQL plugin
     */
    graphqlGateway: Gateway
  }

  interface FastifyReply {
    /**
     * @param source GraphQL query string
     * @param context request context
     * @param variables request variables which will get passed to the executor
     * @param operationName specify which operation will be run
     */
    graphql<
      TData extends Record<string, any> = Record<string, any>,
      TVariables extends Record<string, any> = Record<string, any>
      >(
      source: string,
      context?: Record<string, any>,
      variables?: TVariables,
      operationName?: string
    ): Promise<ExecutionResult<TData>>;
  }
}

/**
 * Federated GraphQL Service metadata
 */
export interface MercuriusServiceMetadata {
  name: string;
}

export interface Collectors {
  collectHeaders?: boolean;
  collectStatutsCodes?: boolean;
  collectExtensions?: boolean;
}

interface WsConnectionParams {
  connectionInitPayload?:
    | (() => Record<string, any> | Promise<Record<string, any>>)
    | Record<string, any>;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  connectionCallback?: () => void;
  failedConnectionCallback?: (err: { message: string }) => void | Promise<void>;
  failedReconnectCallback?: () => void;
  rewriteConnectionInitPayload?: <TContext extends MercuriusContext = MercuriusContext>(payload: Record<string, any> | undefined, context: TContext) => Record<string, any>;
}

export interface MercuriusGatewayService {
  name: string;
  url: string | string[];
  schema?: string;
  wsUrl?: string;
  mandatory?: boolean;
  initHeaders?:
    | (() => OutgoingHttpHeaders | Promise<OutgoingHttpHeaders>)
    | OutgoingHttpHeaders;
  rewriteHeaders?: <TContext extends MercuriusContext = MercuriusContext>(
    headers: IncomingHttpHeaders,
    context: TContext
  ) => OutgoingHttpHeaders | Promise<OutgoingHttpHeaders>;
  connections?: number;
  keepAlive?: number;
  keepAliveMaxTimeout?: number;
  rejectUnauthorized?: boolean;
  wsConnectionParams?:
    | (() => WsConnectionParams | Promise<WsConnectionParams>)
    | WsConnectionParams;
  setResponseHeaders?: (reply: FastifyReply) => void;
  collectors?: Collectors;
}

export interface MercuriusGatewayOptions {
  gateway: {
    services: Array<MercuriusGatewayService> | (() => Promise<Array<MercuriusGatewayService>>);
    pollingInterval?: number;
    errorHandler?(error: Error, service: MercuriusGatewayService): void;
    retryServicesCount?: number;
    retryServicesInterval?: number;
  };
}

type MercuriusFederationOptions = MercuriusOptions & MercuriusGatewayOptions

declare const mercuriusGatewayPlugin: (
  instance: FastifyInstance,
  opts: MercuriusFederationOptions
) => void

export default mercuriusGatewayPlugin;

// ------------------------
// Request Lifecycle hooks
// ------------------------

/**
 * `preGatewayExecution` is the hook to be executed in the GraphQL gateway request lifecycle.
 * The previous hook was `preExecution`, the next hook will be `onResolution`.
 * Notice: in the `preGatewayExecution` hook, you can modify the following items by returning them in the hook definition:
 *  - `document`
 *  - `errors`
 * Each hook definition will trigger multiple times in a single request just before executing remote GraphQL queries on the federated services.
 *
 * Because it is a gateway hook, this hook contains service metadata in the `service` parameter:
 *  - `name`: service name
 */
export interface preGatewayExecutionHookHandler<TContext = MercuriusContext, TError extends Error = Error> {
  (
    schema: GraphQLSchema,
    source: DocumentNode,
    context: TContext,
    service: MercuriusServiceMetadata
  ): Promise<PreExecutionHookResponse<TError> | void> | PreExecutionHookResponse<TError> | void;
}

// -----------------------------
// Subscription Lifecycle hooks
// -----------------------------

/**
 * `preGatewaySubscriptionExecution` is the hook to be executed in the GraphQL gateway subscription lifecycle.
 * The previous hook was `preSubscriptionExecution`, the next hook will be `onSubscriptionResolution`.
 *
 *  Because it is a gateway hook, this hook contains service metadata in the `service` parameter:
 *  - `name`: service name
 */
export interface preGatewaySubscriptionExecutionHookHandler<TContext = MercuriusContext> {
  (
    schema: GraphQLSchema,
    source: DocumentNode,
    context: TContext,
    service: MercuriusServiceMetadata
  ): Promise<void> | void;
}

// ----------------------------
// Application Lifecycle hooks
// ----------------------------

/**
 * `onGatewayReplaceSchema` is an application lifecycle hook. When the Gateway service obtains new versions of federated schemas within a defined polling interval, the `onGatewayReplaceSchema` hook will be triggered every time a new schema is built. It is called just before the old schema is replaced with the new one.
 * This hook will only be triggered in gateway mode. It has the following parameters:
 *  - `instance` - The gateway server `FastifyInstance` (this contains the old schema).
 *  - `schema` - The new schema that has been built from the gateway refresh.
 */
export interface onGatewayReplaceSchemaHookHandler {
  (
    instance: FastifyInstance,
    schema: GraphQLSchema
  ): Promise<void> | void;
}
