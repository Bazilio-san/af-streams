/* eslint-disable class-methods-use-this */
import * as net from 'net';
import { Buffer } from 'buffer';
import AbstractSender from './AbstractSender';
import { IEventComposite, IRecordsComposite, ISenderConstructorOptions, TEventRecord } from '../interfaces';

export interface ITCPSocket extends net.Socket {
  readyState: string
}

class TCPJSONSender extends AbstractSender {
  public isReady: boolean;

  // noinspection TypeScriptFieldCanBeMadeReadonly
  private socket: ITCPSocket | net.Socket | null;

  constructor (options: ISenderConstructorOptions) {
    super(options);
    this.isReady = true;
    this.socket = null;
  }

  async connect (): Promise<boolean> {
    const self = this;
    const { echo, logger } = this.options;
    const { port = -1, host = 'unknown' } = self.senderConfig;
    return new Promise((resolve) => {
      if (self.isConnected()) {
        resolve(true);
        return;
      }
      self.socket = new net.Socket();
      const { socket } = self;
      const msg = `(${host}:${port})`;
      socket.on('error', (err: Error | any) => {
        const { code, message } = err;
        if (code === 'ECONNREFUSED') {
          echo.error(message);
        } else {
          logger.error(err);
        }
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        echo.error(`Timeout exceed ${msg}`);
        resolve(false);
      });
      socket.on('close', (eee) => {
        echo.info(`TCP connection closed: ${msg} ${eee}`);
      });
      socket.on('data', (/* data */) => {
        // console.log(`WSO2 Says : ${data}`);
      });
      socket.connect(port, host, () => {
        echo.info(`
======================= TCP JSON Sender ========================
Connection established with ${msg}
================================================================`);
        socket.setKeepAlive(true, 5000);
        const { readyState } = socket as ITCPSocket;
        if (readyState === 'open') {
          return resolve(true);
        }
        echo.error(`readyState = ${readyState} ${msg}`);
        resolve(false);
      });
    });
  }

  async reconnect (): Promise<boolean> {
    if (this.isConnected()) {
      try {
        this.shutdown();
      } catch (err) {
        this.options.logger.error(err);
      }
    }
    return this.connect();
  }

  async tryConnect (): Promise<boolean> {
    if (this.isConnected()) {
      return true;
    }
    return this.connect();
  }

  isConnected (): boolean {
    const socket = this.socket as ITCPSocket;
    return socket?.readyState === 'open'; // VVQ
  }

  shutdown () {
    if (this.socket) {
      this.socket.destroy();
    }
  }

  canSendNext (): boolean {
    return this.isReady && this.isConnected();
  }

  getTcpHeaderLength ({ sessionId, streamId }: { sessionId: string, streamId: string }): number {
    return 1 + 4 + 4 + Buffer.byteLength(sessionId) + 4 + Buffer.byteLength(streamId) + 4;
  }

  /**
   * Encoding a JSON message containing 1 or more events into a buffer ready to be sent over TCP to WSO2
   */
  encodeMessage (eventComposite: IEventComposite): Buffer | null {
    const { sessionId, streamId, json } = eventComposite;
    if (!sessionId || !streamId || !json) {
      return null;
    }

    const sessionIdSize = Buffer.byteLength(sessionId);
    const streamIdSize = Buffer.byteLength(streamId);
    const jsonSize = Buffer.byteLength(json);

    const messageSize = 4 + sessionIdSize + 4 + streamIdSize + 4 + jsonSize;

    const buffer = Buffer.alloc(5 + messageSize);

    buffer.writeInt8(2);
    let offset = 1;

    buffer.writeUInt32BE(messageSize, offset);
    offset += 4;

    buffer.writeUInt32BE(sessionIdSize, offset);
    offset += 4;
    buffer.write(sessionId, offset);
    offset += sessionIdSize;

    buffer.writeUInt32BE(streamIdSize, offset);
    offset += 4;
    buffer.write(streamId, offset);
    offset += streamIdSize;

    buffer.writeUInt32BE(jsonSize, offset);
    offset += 4;
    buffer.write(json, offset);
    return buffer;
  }

  /**
   * Sending an event package to WSO2
   *
   * @return - buffer.length if the message has been sent, "false" otherwise
   */
  async _sendEventsPacket (recordsComposite: IRecordsComposite): Promise<number | boolean> {
    const { sessionId, streamId, eventsPacket } = recordsComposite;
    const json = JSON.stringify(eventsPacket);
    const buffer = this.encodeMessage({ sessionId, streamId, json });
    const isConnected = await this.tryConnect();
    if (!isConnected) {
      return false;
    }
    this.socket?.write(buffer as Uint8Array);
    return buffer?.length || 0;
  }

  /**
   * Sending events to WSO2
   */
  async sendEvents (recordsComposite: IRecordsComposite): Promise<boolean> {
    const MAX_PACKET_SIZE = 32000;

    const { streamId, eventsPacket, isSingleRecordAsObject, first } = recordsComposite;
    if (!eventsPacket.length) {
      return false;
    }
    let { sessionId } = recordsComposite;
    if (!sessionId) {
      sessionId = `sid${+(new Date())}`; // VVQ добавить \00\00 перед sid
    }
    const MAX_DATA_SIZE = MAX_PACKET_SIZE - this.getTcpHeaderLength({ sessionId, streamId }) - 1;
    let stop = false;
    recordsComposite.sentBufferLength = 0;
    recordsComposite.sendCount = 0;
    recordsComposite.last = first;
    while (!stop && eventsPacket.length > 0) {
      let dataLen = 0;
      let isEnough = false;
      const packet = [] as TEventRecord[];
      while (!isEnough && eventsPacket.length) {
        const itemLen = Buffer.byteLength(JSON.stringify(eventsPacket[0])) + 1;
        if (dataLen + itemLen >= MAX_DATA_SIZE) {
          isEnough = true;
        } else {
          packet.push(eventsPacket.shift() as TEventRecord);
          dataLen += itemLen;
        }
      }
      const pl = packet.length;
      if (pl) {
        const data = {
          dataLen,
          sessionId,
          streamId,
          eventsPacket: pl === 1 && isSingleRecordAsObject ? packet[0] : packet,
        };
        // eslint-disable-next-line no-await-in-loop
        const sentBufferLength = await this._sendEventsPacket(data);
        stop = !sentBufferLength;
        if (stop) {
          eventsPacket.splice(0, 0, ...packet);
        } else {
          recordsComposite.sentBufferLength += sentBufferLength as number;
          recordsComposite.sendCount += pl;
          recordsComposite.last = packet[pl - 1];
        }
      }
    }
    return true;
  }
}

export default TCPJSONSender;
