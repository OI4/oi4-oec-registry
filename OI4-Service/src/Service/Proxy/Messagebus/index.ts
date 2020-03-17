import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { IContainerState, IContainerConfig } from '../../Container/index';
import { IOPCUAData, IMasterAssetModel } from '../../Models/IOPCUAPayload.js';
import { OI4Proxy } from '../index';
import { hasKey } from '../../Utilities/index';
import { Logger } from '../../Utilities/Logger/index';
import { EDeviceHealth, ESubResource } from '../../Models/IContainer';

interface TMqttOpts {
  clientId: string;
  servers: object[];
  will: object;
}

class OI4MessageBusProxy extends OI4Proxy {
  private client: mqtt.AsyncClient;
  private logger: Logger;
  constructor(container: IContainerState) {
    super(container);

    // Add Server Object depending on configuration
    const serverObj = {
      host: process.env.OI4_ADDR as string,
      port: parseInt(process.env.OI4_PORT as string, 10),
    };
    console.log(`MQTT: Trying to connect with ${serverObj.host}:${serverObj.port}`);

    // Create dummy TLS object, that is certain to be rejected!
    // serverObj = {
    //   host: environment.broker.ip,
    //   port: 8883,
    //   key: 'dummykey',
    //   cert: 'dummycert',
    //   rejectUnauthorized: true,
    //   ca: 'dummyca',
    //   protocol: 'mqtts',
    // };
    // Initialize MQTT Options

    const mqttOpts: TMqttOpts = {
      clientId: `MessageBus${process.env.CONTAINERNAME as string}`,
      servers: [serverObj],
      will: {
        topic: `oi4/${this.serviceType}/${this.appId}/pub/health/${this.appId}`,
        payload: JSON.stringify(this.builder.buildOPCUADataMessage({
          health: EDeviceHealth.FAILURE_1,
          healthState: 0,
        }, new Date(), 'healthClass')), /*tslint:disable-line*/
        qos: 0,
      },
    };

    this.client = mqtt.connect(mqttOpts);
    this.logger = new Logger(true, 'Registry-Messagebus', ESubResource.warn, this.client, this.appId, this.serviceType);
    this.logger.log(`BusProxy: Standardroute: ${this.standardRoute}`, 'y', ESubResource.info);
    // Publish Birth Message and start listening to topics
    this.client.on('connect', async (connack: mqtt.IConnackPacket) => {
      this.logger.log('BusProxy: Connected successfully', 'w' , ESubResource.info);
      await this.client.publish(
        `${this.standardRoute}/pub/mam/${this.appId}`,
        JSON.stringify(this.builder.buildOPCUADataMessage(this.containerState.mam, new Date(), 'BIRTHMESSAGECLASSID')),
      );
      this.logger.log(`BusProxy: Published Birthmessage on ${this.standardRoute}/pub/mam/${this.appId}`, 'w', ESubResource.info);

      // Listen to own routes
      this.client.subscribe(`${this.standardRoute}/get/#`);
      this.client.subscribe(`${this.standardRoute}/set/#`);
      this.client.subscribe(`${this.standardRoute}/del/#`);

      this.client.on('message', this.processMqttMessage);
      setInterval(() => { this.sendResource('health'); }, 60000); // send our own health every 30 seconds!
    });
  }

  /**
   * Processes the incoming mqtt message by parsing the different elements of the topic and reacting to it
   * @param topic - the incoming topic from the messagebus
   * @param message - the entire binary message from the messagebus
   */
  private processMqttMessage = async (topic: string, message: Buffer) => {
    // Convert message to JSON, TODO: if this fails, we return an Error
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message.toString());
    } catch (e) {
      this.logger.log(`Registry: Error when parsing JSON in processMqttMessage: ${e}`);
      return;
    }
    const schemaResult = await this.builder.checkOPCUAJSONValidity(parsedMessage);
    if (!schemaResult) {
      this.logger.log('BusProxy: Error in payload schema validation');
      return;
    }
    // Split the topic into its different elements
    const topicArray = topic.split('/');
    const topicServiceType = topicArray[1];
    const topicAppId = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
    const topicMethod = topicArray[6];
    const topicResource = topicArray[7];
    const topicTag = topicArray.splice(8).join('/');

    // The following switch/case reacts depending on the different topic elements

    // The message is directed directly at us
    if (topicAppId === this.appId) {
      switch (topicMethod) {
        case 'get': {
          switch (topicResource) {
            case 'health': {
              if (topicTag === this.appId) {
                await this.sendResource('health', parsedMessage.MessageId);
              }
              break;
            }
            case 'config': {
              if (topicTag === this.appId) {
                await this.sendResource('config', parsedMessage.MessageId);
              }
              break;
            }
            case 'license': {
              if (topicTag === this.appId) {
                await this.sendResource('license', parsedMessage.MessageId);
              }
              break;
            }
            case 'rtLicense': {
              if (topicTag !== '') {
                await this.sendResource('rtLicense', parsedMessage.MessageId);
              }
              break;
            }
            case 'licenseText': {
              if (topicTag !== '') {
                await this.sendLicenseText(topicTag, parsedMessage.MessageId);
              }
              break;
            }
            case 'mam': {
              await this.sendResource(topicResource, parsedMessage.MessageId);
              break;
            }
            case 'data': {
              this.emit('getData', { topic, message: parsedMessage });
              break;
            }
            case 'metadata': {
              await this.sendMetaData(topicTag);
              break;
            }
            case 'profile': {
              if (topicTag !== '') {
                await this.sendResource('profile', parsedMessage.MessageId);
              }
              break;
            }
            default: {
              await this.sendError(`Internal GetError with resource ${topicResource}`);
              break;
            }
          }
          break;
        }
        case 'pub': {
          break; // Only break here, because we should not react to our own publication messages
        }
        case 'set': {
          switch (topicResource) {
            case 'data': {
              this.setData(topicTag, parsedMessage);
              break;
            }
            case 'config': {
              this.setConfig(parsedMessage);
              break;
            }
            default: {
              this.sendError('SetError');
              break;
            }
          }
          break;
        }
        case 'del': {
          switch (topicResource) {
            case 'data': {
              this.deleteData(topicTag);
              break;
            }
            default: {
              this.sendError('DeleteError');
              break;
            }
          }
          break;
        }
        default: {
          break;
        }
      }
      // External Request (External device put this on the message bus, we need this for birth messages)
    } else {
      switch (topicMethod) {
        case 'get': {
          switch (topicResource) {
            case 'mam': {
              if (topicServiceType === 'Registry') {
                this.sendResource(topicResource); // Exception in base-app. Since the registry does not know itself, we need to send out the mam here
              }
              break;
            }
            default: {
              this.sendError('GetError');
              break;
            }
          }
          break;
        }
        case 'pub': {
          break; // Only break here, we don't listen to pubs
        }
        case 'set': {
          switch (topicResource) {
            case 'data': {
              this.setData(topicTag, parsedMessage);
              break;
            }
            case 'config': {
              this.setConfig(parsedMessage);
              break;
            }
            default: {
              this.sendError('SetError');
              break;
            }
          }
          break;
        }
        case 'del': {
          switch (topicResource) {
            case 'data': {
              this.deleteData(topicTag);
              break;
            }
            default: {
              this.sendError('DeleteError');
              break;
            }
          }
          break;
        }
        default: {
          break;
        }
      }
    }
  }

  // GET SECTION ----------------//
  /**
   * Sends all available metadata of the containerState to the bus
   * @param cutTopic - the cutTopic, containing only the tag-element
   */
  async sendMetaData(cutTopic: string) {
    const tagName = cutTopic; // Remove the leading /
    if (tagName === '') { // If there is no tag specified, we should send all available metadata
      await this.client.publish(`${this.standardRoute}/pub/metadata`, JSON.stringify(this.containerState.metaDataLookup));
      this.logger.log(`BusProxy: Published ALL available MetaData on ${this.standardRoute}/pub/metadata`);
      return;
    }
    // This topicObject is also specific to the resource. The data resource will include the TagName!
    const dataLookup = this.containerState.dataLookup;
    if (tagName in dataLookup) {
      await this.client.publish(`${this.standardRoute}/pub/metadata/${tagName}`, JSON.stringify(this.containerState.metaDataLookup[tagName]));
      this.logger.log(`BusProxy: Published available MetaData on ${this.standardRoute}/pub/metadata/${tagName}`);
    }
  }

  /**
   * Sends all available data of the containerState to the bus
   * @param cutTopic - the cuttopic, containing only the tag-element
   */
  async sendData(cutTopic: string) {
    const tagName = cutTopic;
    if (tagName === '') { // If there is no tag specified, we shuld send all available data
      await this.client.publish(`${this.standardRoute}/pub/data`, JSON.stringify(this.containerState.dataLookup));
      this.logger.log(`BusProxy: Published ALL available Data on ${this.standardRoute}/pub/data`);
      return;
    }
    // This topicObject is also specific to the resource. The data resource will include the TagName!
    const dataLookup = this.containerState.dataLookup;
    if (tagName in dataLookup) {
      await this.client.publish(`${this.standardRoute}/pub/data/${tagName}`, JSON.stringify(this.containerState.dataLookup[tagName]));
      this.logger.log(`BusProxy: Published available Data on ${this.standardRoute}/pub/data/${tagName}`);
    }
  }

  /**
   * Sends the saved Resource from containerState to the message bus
   * @param resource - the resource that is to be sent to the bus (health, license etc.)
   * @param messageId - the messageId that was sent to us with the request. If it's present, we need to put it into the correlationID of our response
   */
  async sendResource(resource: string, messageId: string = '') {
    if (hasKey(this.containerState, resource)) {
      await this.client.publish(
        `${this.standardRoute}/pub/${resource}/${this.appId}`,
        JSON.stringify(this.builder.buildOPCUADataMessage(this.containerState[resource], new Date(), `${resource}-${this.serviceType}-ClassId`, messageId)));
      this.logger.log(`BusProxy: Published ${resource} on ${this.standardRoute}/pub/${resource}/${this.appId}`);
    }
  }

  /**
   * Sends the licenseText specific to the license of the containerState to the message bus
   * TODO: Maybe cover this in the sendResource function?
   * @param license - the license of which the text is requested
   * @param messageId - the messageId that was sent to us with the request. If it's present, we need to put it into the correlationID of our response
   */
  async sendLicenseText(license: string, messageId: string = '') {
    if (typeof this.containerState.licenseText[license] === 'undefined') { // FIXME: REMOVE THE HOTFIX AND BUILD A CHECKER INTO OPCUABUILDER
      return;
    }
    await this.client.publish(`${this.standardRoute}/pub/licenseText/${license}`, JSON.stringify(this.builder.buildOPCUADataMessage({ licText: this.containerState.licenseText[license] }, new Date(), 'licenseTextClass', messageId)));
    this.logger.log(`BusProxy: Published LicenseText on ${this.standardRoute}/pub/licenseText/${this.appId}`);
  }

  /**
   * Sends an event/event with a specified level to the message bus
   * @param eventStr - The string that is to be sent as the 'event'
   * @param level - the level that is used as a <subresource> element in the event topic
   */
  async sendEvent(eventStr: string, level: string) {
    const opcUAEvent = this.builder.buildOPCUADataMessage({
      number: 1,
      description: 'Registry sendEvent',
      payload: {
        logLevel: level,
        logString: eventStr,
      },
    }, new Date(), 'eventID'); /*tslint:disable-line*/
    await this.client.publish(`${this.standardRoute}/pub/event/${level}/${this.appId}`, JSON.stringify(opcUAEvent));
    this.logger.log(`BusProxy: Published event on ${this.standardRoute}/event/${level}/${this.appId}`);
  }

  // Basic Error Functions
  async sendError(error: string) {
    this.logger.log(`BusProxy: Error: ${error}`);
  }

  // SET Function section ------//
  setData(cutTopic: string, data: IOPCUAData) {
    const tagName = cutTopic;
    // This topicObject is also specific to the resource. The data resource will include the TagName!
    const dataLookup = this.containerState.dataLookup;
    if (tagName === '') {
      return;
    }
    if (!(tagName in dataLookup)) {
      this.containerState.dataLookup[tagName] = data;
      this.logger.log(`BusProxy: Added ${tagName} to dataLookup`);
    } else {
      this.containerState.dataLookup[tagName] = data; // No difference if we create the data or just update it with an object
      this.logger.log(`BusProxy: ${tagName} already exists in dataLookup`);
    }
  }

  /**
   * Update the containerstate with the configObject
   * @param configObject - the object that is to be passed to the ContainerState
   */
  setConfig(configObject: IContainerConfig) {
    this.containerState.config = configObject;
    this.logger.log('BusProxy: Updated config(no CREATE possible)');
  }

  // DELETE Function section
  /**
   * Legacy: TODO: This is not specified by the specification yet
   * @param cutTopic - todo
   */
  deleteData(cutTopic: string) {
    // ONLY SPECIFIC DATA CAN BE DELETED. WILDCARD DOES NOT DELETE EVERYTHING
    const tagName = cutTopic;
    // This topicObject is also specific to the resource. The data resource will include the TagName!
    const dataLookup = this.containerState.dataLookup;
    if (tagName === '') {
      return;
    }
    if ((tagName in dataLookup)) {
      delete this.containerState.dataLookup[tagName];
      this.logger.log(`BusProxy: Deleted ${tagName} from dataLookup`);
    } else {
      this.logger.log(`BusProxy: Cannot find ${tagName} in lookup`);
    }
  }

  /**
   * Makes the MQTT Client available to be used by other applications
   */
  get mqttClient() {
    return this.client;
  }
}

export { OI4MessageBusProxy };
