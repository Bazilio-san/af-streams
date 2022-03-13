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
    this.options.echo.info(`=================== Emitter Sender is Ready ====================`);
    return true;
  }

  async sendEvents (recordsComposite: IRecordsComposite): Promise<boolean> {
    const { eventsPacket } = recordsComposite;
    if (this.emitSingleEvent) {
      recordsComposite.eventsPacket.forEach((event: TEventRecord) => {
        this.eventEmitter.emit(this.emitId, event);
      });
    } else {
      this.eventEmitter.emit(this.emitId, eventsPacket);
    }
    return true;
  }
}

export default EmitterSender;
