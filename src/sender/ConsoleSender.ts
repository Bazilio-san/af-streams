/* eslint-disable class-methods-use-this,no-console */
import AbstractSender from './AbstractSender';
import { IRecordsComposite, TEventRecord } from '../interfaces';

class ConsoleSender extends AbstractSender {
  async connect () {
    console.log(`
================================================
Stream logging to console
================================================
`);
    return true;
  }

  async sendEvents (recordsComposite: IRecordsComposite): Promise<boolean> {
    recordsComposite.eventsPacket.forEach((row: TEventRecord) => {
      console.log(JSON.stringify(row));
    });
    return true;
  }
}

export default ConsoleSender;
