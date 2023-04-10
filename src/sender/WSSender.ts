/* eslint-disable class-methods-use-this,no-await-in-loop */
import { io, Socket } from 'socket.io-client';
import { sleep } from '../utils/utils';
import AbstractSender from './AbstractSender';
import { cyan, lBlue, reset } from '../utils/color';
import { IRecordsComposite, ISenderConstructorOptions, Nullable, TAccessPoint } from '../interfaces';

const AWAIT_SOCKET_TIMEOUT = 10_000;
const LOOP_SLEEP_MILLIS = 1000;

class WSSender extends AbstractSender {
  private lastConfigServiceAddress: string;

  private address: string;

  private mConsulServiceName: string;

  private socketClient: Nullable<Socket>;

  private readonly accessPointId: string;

  private token: string;

  private readonly socketRequestId: string;

  private onAccessPointUpdatedCallBack: OmitThisParameter<({ accessPoint }: { accessPoint: TAccessPoint }) => void>;

  constructor (options: ISenderConstructorOptions) {
    super(options);
    this.lastConfigServiceAddress = '';
    const { senderConfig } = options;
    const { host, port } = senderConfig;
    const ap = senderConfig.accessPoint as TAccessPoint;
    this.address = `http://${host}:${port}`;
    this.mConsulServiceName = `${cyan}${ap.consulServiceName}${reset}`;
    this.socketClient = null;
    this.accessPointId = ap.id as string;
    this.token = ap.token as string;
    this.socketRequestId = ap.socketRequestId as string;
    this.onAccessPointUpdatedCallBack = this.onAccessPointUpdated.bind(this);
    options.commonConfig.eventEmitter.on('access-point-updated', this.onAccessPointUpdatedCallBack);

    this.reconnect().then(() => 0);
  }

  onAccessPointUpdated ({ accessPoint }: { accessPoint: TAccessPoint }) {
    if (accessPoint.id === this.accessPointId) {
      this.reconnect().then(() => 0);
    }
  }

  isConnected (): boolean {
    return Boolean(this.socketClient?.emit && this.socketClient?.connected);
  }

  async connect (): Promise<boolean> {
    const { address, mConsulServiceName, token, options } = this;
    const { commonConfig: { echo, logger, serviceName } } = options;
    if (!serviceName) {
      throw new Error(`No host serviceName specified in senders.${this.options.senderConfig.type} configuration`);
    }
    const mAddress = `${lBlue}${address}${reset}`;

    echo.info(`Connect to ${cyan}WEB SOCKET${reset} on ${lBlue}${address}${reset}`);

    const opt = {
      query: { fromService: serviceName },
      auth: { token },
      extraHeaders: { authorization: token },
    };

    const socketClient = io(address, opt);
    this.socketClient = socketClient;

    return new Promise((resolve) => {
      socketClient.on('connect', () => {
        echo.info(`
====================== Web Socket Sender =======================
Connection established with WEBSOCKET ${mConsulServiceName} on ${mAddress}
================================================================`);
        resolve(true);
      });

      socketClient.on('unauthorized', (reason, callback) => {
        logger.error(`Error on "unauthorized" event while connecting to config service via socket. Reason: ${reason}`);
        resolve(false);
        callback();
      });

      socketClient.on('disconnect', () => {
        logger.warn(`Config service instance ${mConsulServiceName} disconnected`);
        resolve(false);
      });

      socketClient.on('error', (err) => {
        logger.error(err);
        resolve(false);
      });
    });
  }

  async reconnect (force?: boolean): Promise<boolean> {
    const { options: { senderConfig: { port, host } }, lastConfigServiceAddress } = this;
    if (!host || !port) {
      return this.isConnected();
    }
    const address = `http://${host}:${port}`;
    if (force || (lastConfigServiceAddress !== address)) {
      this.lastConfigServiceAddress = address;
      this.address = address;
      return this.connect();
    }
    return false;
  }

  async awaitSocket () {
    if (this.isConnected()) {
      return true;
    }
    const start = Date.now();
    while (!this.isConnected() && (Date.now() - start < AWAIT_SOCKET_TIMEOUT)) {
      if (Date.now() - start < LOOP_SLEEP_MILLIS) {
        this.options.commonConfig.logger.silly('Try to connect to the socket...');
      } else {
        this.options.commonConfig.logger.warn('Socket is not still connected...');
      }
      await this.reconnect(true);
      await sleep(LOOP_SLEEP_MILLIS);
    }
    return this.isConnected();
  }

  async remoteSocket (rqId: string, ...args: any[]): Promise<{ error?: any, result?: any }> {
    const self = this;
    const error = `NOT connected to the socket. Request id: ${rqId}`;
    if (await this.awaitSocket()) {
      return new Promise((resolve) => {
        if (!self.isConnected()) {
          this.options.commonConfig.logger.error(error);
          resolve({ error });
          return;
        }
        args.push((a: any) => {
          resolve(a);
        });
        this.socketClient?.emit(rqId, ...args);
      });
    }
    return { error };
  }

  async sendEvents (recordsComposite: IRecordsComposite): Promise<boolean> {
    const MAX_PACKET_SIZE = 100; // Max number of events in a batch

    const { eventsPacket, first } = recordsComposite;
    if (!eventsPacket.length) {
      return false;
    }

    let stop = false;

    recordsComposite.sentBufferLength = 0;
    recordsComposite.sendCount = 0;
    recordsComposite.last = first;
    while (!stop && eventsPacket.length > 0) {
      const packet = eventsPacket.splice(0, MAX_PACKET_SIZE);
      const pl = packet.length;
      if (pl) {
        /*
        // receiving side signature:
        socket.on(socketRequestId, (request, callback) => {
          callback({ result: true });
        });
        */
        const { error, result } = await this.remoteSocket(this.socketRequestId, packet);
        stop = !result;
        if (stop) {
          if (error) {
            this.options.commonConfig.logger.error(error);
          }
          eventsPacket.splice(0, 0, ...packet);
        } else {
          recordsComposite.sendCount += pl;
          recordsComposite.last = packet[pl - 1];
        }
      }
    }
    return true;
  }

  destroy () {
    this.options.commonConfig.eventEmitter.on('access-point-updated', this.onAccessPointUpdatedCallBack);
    this.socketClient?.disconnect();
    // @ts-ignore
    this.socketClient = undefined;
  }
}

export default WSSender;
