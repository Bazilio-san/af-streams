import AbstractSender from './AbstractSender';
import { IRecordsComposite, ISenderConstructorOptions, TEventRecord } from '../interfaces';

class CallbackSender extends AbstractSender {
  private readonly callback: Function;

  constructor (options: ISenderConstructorOptions) {
    super(options);

    const { callback } = options.senderConfig;
    if (typeof callback !== 'function') {
      options.exitOnError(`Missing callback function when instantiating CallbackSender class`);
    }
    this.callback = callback as Function;
  }

  async connect () {
    this.options.echo.info(`=================== Callback Sender is Ready ====================`);
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

    packet.forEach((row: TEventRecord) => {
      this.callback(row);
    });
    return true;
  }
}

export default CallbackSender;
