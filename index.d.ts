import { FastifyInstance, FastifyReply } from 'fastify'
import { MercuriusContext, MercuriusOptions } from 'mercurius'
import { IncomingHttpHeaders, OutgoingHttpHeaders } from "http"

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
}

export interface MercuriusGatewayOptions {
  gateway: {
    services: Array<MercuriusGatewayService>;
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
