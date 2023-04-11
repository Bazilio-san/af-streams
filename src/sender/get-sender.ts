import { ISender, ISenderConstructorOptions, TAccessPoint } from '../interfaces';
import TCPJSONSender from './TCPJSONSender';
import WSSender from './WSSender';
import CallbackSender from './CallbackSender';
import ConsoleSender from './ConsoleSender';
import EmitterSender from './EmitterSender';

const sendersCache: { [streamId: string]: ISender } = {};

const accessPointTimeOutMillis = 10_000;
const checkAccessPointAvailability = async (options: ISenderConstructorOptions) => {
  const accessPoint = options.senderConfig.accessPoint as TAccessPoint;
  const exitOnError = options.commonConfig.exitOnError as Function;
  if (!(await accessPoint?.waitForHostPortUpdated?.(10_000))) {
    exitOnError(`Access point "${accessPoint?.id}" update timed out ${accessPointTimeOutMillis} ms`);
  }
};

export const getSender = async (options: ISenderConstructorOptions): Promise<ISender> => {
  const { streamId } = options;
  let sender = sendersCache[streamId];
  if (sender) {
    return sender;
  }
  const { senderConfig } = options;
  switch (senderConfig.type) {
    case 'tcp': {
      await checkAccessPointAvailability(options);
      sender = new TCPJSONSender(options);
      break;
    }
    case 'ws': {
      await checkAccessPointAvailability(options);
      sender = new WSSender(options);
      break;
    }
    case 'callback': {
      sender = new CallbackSender(options);
      break;
    }
    case 'emitter': {
      sender = new EmitterSender(options);
      break;
    }
    default:
      sender = new ConsoleSender(options);
  }
  sendersCache[streamId] = sender;

  const isConnectedToTarget = await sender.connect();
  if (!isConnectedToTarget) {
    options.commonConfig.exitOnError('No connection to sender');
  }

  return sender;
};

export const destroySender = (sender: ISender) => {
  const { streamId } = sender.options;
  sender.destroy();
  delete sendersCache[streamId];
};
