/* eslint-disable class-methods-use-this,@typescript-eslint/no-unused-vars,no-unused-vars */
import { IRecordsComposite, ISenderConfig, ISenderConstructorOptions } from '../interfaces';

class AbstractSender {
  public senderConfig: ISenderConfig;

  public options: ISenderConstructorOptions;

  constructor (options: ISenderConstructorOptions) {
    const { senderConfig } = options;
    const { type, host, port } = senderConfig;
    this.options = options;
    this.senderConfig = senderConfig;
    if (['tcp', 'ws'].includes(type)) {
      if (host == null) {
        throw new Error(`No host specified in senders.${type} configuration`);
      }
      if (port == null) {
        throw new Error(`No port specified in senders.${type} configuration`);
      }
    }
  }

  async connect (): Promise<boolean> {
    return true;
  }

  async reconnect (force?: boolean): Promise<boolean> {
    return true;
  }

  isConnected (): boolean {
    return true;
  }

  shutdown (): void {
  }

  canSendNext (): boolean {
    return true;
  }

  async sendEvents (recordsComposite: IRecordsComposite): Promise<boolean> {
    return true;
  }
}

export default AbstractSender;
