/* eslint-disable no-console,no-constructor-return */
import { cyan, green, magenta, red, reset, underlineOff, yellow } from './color';

class EchoSimple extends Function {
  public prefix: string;

  constructor (prefix?: string) {
    super();
    this.prefix = prefix || '';

    // @ts-ignore
    return new Proxy(this, { apply: (target, that, args) => target.echo(...args) });
  }

  /**
   * The function of outputting a message to the console with the possibility of coloring and setting a prefix.
   */
  echo (msg: string): void {
    console.log(`\x1b[49;39m${underlineOff}${this.prefix}${msg}${reset}`);
  }

  g (msg: string): void {
    console.log(`${green}${this.prefix}${msg}${reset}`);
  }

  error (msg: string): void {
    console.log(`${red}${this.prefix}${msg}${reset}`);
  }

  warn (msg: string): void {
    console.log(`${yellow}${this.prefix}${msg}${reset}`);
  }

  info (msg: string): void {
    console.log(`${green}${this.prefix}${msg}${reset}`);
  }

  debug (msg: string): void {
    console.log(`${cyan}${this.prefix}${msg}${reset}`);
  }

  silly (msg: string): void {
    console.log(`${magenta}${this.prefix}${msg}${reset}`);
  }
}

export const echoSimple = new EchoSimple('');
