import EventEmitter from 'events';
import AbstractSender from './AbstractSender';
import { IRecordsComposite, ISenderConstructorOptions, TEventRecord } from '../interfaces';

class EmitterSender extends AbstractSender {
  private readonly emitSingleEvent: boolean;

  private eventEmitter: EventEmitter;

  private readonly emitId: string;

  constructor (options: ISenderConstructorOptions) {
    super(options);

    const { commonConfig, senderConfig: { emitSingleEvent = false, emitId } } = options;
    if (!commonConfig.eventEmitter) {
      options.commonConfig.exitOnError(`Missing eventEmitter when instantiating EmitterSender class`);
    }
    if (!emitId) {
      options.commonConfig.exitOnError(`Missing emitId when instantiating EmitterSender class`);
    }
    this.eventEmitter = commonConfig.eventEmitter;
    this.emitId = String(emitId);
    this.emitSingleEvent = emitSingleEvent;
  }

  async connect () {
    this.options.commonConfig.echo.info(`=================== Emitter Sender is Ready ===================`);
    return true;
  }

  async sendEvents (recordsComposite: IRecordsComposite): Promise<boolean> {
    const { eventsPacket } = recordsComposite;
    if (!eventsPacket.length) {
      return false;
    }
    const packet = eventsPacket.splice(0, eventsPacket.length);
    const pl = packet.length;
    recordsComposite.sentBufferLength = pl;
    recordsComposite.sendCount = pl;
    recordsComposite.last = packet[pl - 1];

    const { eventEmitter, emitId, options: { streamId } } = this;
    if (this.emitSingleEvent) {
      packet.forEach((event: TEventRecord) => {
        eventEmitter.emit(emitId, { streamId, event });
      });
    } else {
      eventEmitter.emit(emitId, { streamId, packet });
    }
    return true;
  }

  destroy () {
    // @ts-ignore
    this.eventEmitter = undefined;
  }
}

export default EmitterSender;
