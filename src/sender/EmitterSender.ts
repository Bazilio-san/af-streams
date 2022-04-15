import EventEmitter from 'events';
import AbstractSender from './AbstractSender';
import { IRecordsComposite, ISenderConstructorOptions, TEventRecord } from '../interfaces';

class EmitterSender extends AbstractSender {
  private readonly emitSingleEvent: boolean;

  private eventEmitter: EventEmitter;

  private readonly emitId: string;

  constructor (options: ISenderConstructorOptions) {
    super(options);

    const { eventEmitter, senderConfig: { emitSingleEvent = false, emitId } } = options;
    if (!eventEmitter) {
      options.exitOnError(`Missing eventEmitter when instantiating EmitterSender class`);
    }
    if (!emitId) {
      options.exitOnError(`Missing emitId when instantiating EmitterSender class`);
    }
    this.eventEmitter = eventEmitter;
    this.emitId = String(emitId);
    this.emitSingleEvent = emitSingleEvent;
  }

  async connect () {
    this.options.echo.info(`=================== Emitter Sender is Ready ===================`);
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
    if (this.emitSingleEvent) {
      packet.eventsPacket.forEach((event: TEventRecord) => {
        this.eventEmitter.emit(this.emitId, event);
      });
    } else {
      this.eventEmitter.emit(this.emitId, packet);
    }
    return true;
  }
}

export default EmitterSender;
