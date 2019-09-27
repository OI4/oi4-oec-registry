import mqtt = require('mqtt');
import { OPCUABuilder } from '../OPCUABuilder/index';

const chalk = require('chalk');

/**
 * Logger implementation.<br>
 * Adds several logging options, including levels and colors of the logs
 */
class Logger {
  /**
   * Constructor of the logger
   * @param {boolean} enabled - enables or disables logging
   * @param {number} level  - sets the minimum logging level
   */

  private colorLookUp: any;
  private _enabled: boolean; /*tslint:disable-line*/
  private _level: number; /*tslint:disable-line*/
  private _mqttClient?: mqtt.Client;
  private _appId?: string;
  private _serviceType?: string;
  private _builder?: OPCUABuilder;

  constructor(enabled: boolean = true, level: number = 1, mqttClient?: mqtt.Client, appId?: string, serviceType?: string) {
    /**
     * Enables or disables the logging. Default: `true`
     * @type {boolean}
     */
    this._enabled = enabled;
    /**
     * A lookup used to shorten the commands that coordinate the colors.
     * @type {Object}
     * @property {w} - abbr. for chalk.white
     * @property {r} - abbr. for chalk.red
     * @property {b} - abbr. for chalk.blue
     * @property {g} - abbr. for chalk.green
     * @property {y} - abbr. for chalk.yellow
     * @property {m} - abbr. for chalk.magenta
     * @property {error} - abbr. for chalk.redBright
     * @property {warn} - abbr. for chalk.yellowBright
     */
    this.colorLookUp = {
      w: chalk.white,
      r: chalk.red,
      b: chalk.blue,
      g: chalk.green,
      y: chalk.yellow,
      m: chalk.magenta,
      error: chalk.bold.redBright,
      warn: chalk.bold.yellowBright,
      white: chalk.white,
      red: chalk.red,
      blue: chalk.blue,
      green: chalk.green,
      yellow: chalk.yellow,
      magenta: chalk.magenta,
    };
    /**
     * The minimum level needed for the log to appear on the console.
     * @type {number}
     */
    this._level = level;

    if (mqttClient) {
      this._mqttClient = mqttClient;
    }
    if (appId) {
      this._appId = appId;
      this._builder = new OPCUABuilder(appId);
    }
    if (serviceType) {
      this._serviceType = serviceType;
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(en: boolean) {
    if (typeof en !== 'boolean') throw new Error('enabled must be of type Boolean');
    this._enabled = en;
  }

  get level() {
    return this._level;
  }

  set level(lvl) {
    if (typeof lvl !== 'number') throw new Error('enabled must be of type Number');
    this._level = lvl;
  }

  /**
   * Wrapper for console.log()
   * @param {string} logstring - string that is to be logged to the console
   * @param {string} color - either the chalk-color or the abbreviated version (e.g 'r' = chalk.red)
   * @param {number} level - the level that the log is to be logged to
   */
  log(logstring: string, color: string = 'white', level = 1) {
    if (this.enabled) {
      if (level >= this.level) {
        console.log(this.colorLookUp[color](logstring)); // eslint-disable-line no-console
        if (this._mqttClient) {
          let logPayload;
          if (this._builder) {
            logPayload = this._builder.buildOPCUADataMessage({
              number: 0,
              description: 'Registry Logger',
              payload: {
                logLevel: level,
                logString: logstring,
              },
            }, new Date(), 'eventID'); /*tslint:disable-line*/
          }
          this._mqttClient.publish(`oi4/${this._serviceType}/${this._appId}/pub/event/debug/${this._appId}`, JSON.stringify(logPayload));
        }
      }
    }
    return logstring;
  }
}
export { Logger };
