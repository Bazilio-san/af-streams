import { ISender, ISenderConstructorOptions, TAccessPoint } from '../interfaces';
import TCPJSONSender from './TCPJSONSender';
import WSSender from './WSSender';
import CallbackSender from './CallbackSender';
import ConsoleSender from './ConsoleSender';
import EmitterSender from './EmitterSender';

let sender: ISender;

const accessPointTimeOutMillis = 10_000;
const checkAccessPointAvailability = async (options: ISenderConstructorOptions) => {
  const accessPoint = options.senderConfig.accessPoint as TAccessPoint;
  const exitOnError = options.exitOnError as Function;
  if (!(await accessPoint?.waitForHostPortUpdated?.(10_000))) {
    exitOnError(`Access point "${accessPoint?.id}" update timed out ${accessPointTimeOutMillis} ms`);
  }
};

const getSender = async (options: ISenderConstructorOptions) => {
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
  return sender;
};

export default getSender;
