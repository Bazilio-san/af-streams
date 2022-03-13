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
    recordsComposite.eventsPacket.forEach((row: TEventRecord) => {
      this.callback(row);
    });
    return true;
  }
}

export default CallbackSender;
