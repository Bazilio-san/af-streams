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
    const { eventsPacket } = recordsComposite;
    if (!eventsPacket.length) {
      return false;
    }
    const packet = eventsPacket.splice(0, eventsPacket.length);
    const pl = packet.length;
    recordsComposite.sentBufferLength = pl;
    recordsComposite.sendCount = pl;
    recordsComposite.last = packet[pl - 1];
    packet.eventsPacket.forEach((row: TEventRecord) => {
      console.log(JSON.stringify(row));
    });
    return true;
  }
}

export default ConsoleSender;
