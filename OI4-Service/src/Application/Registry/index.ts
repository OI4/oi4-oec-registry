import { IEventObject, EDeviceHealth } from '../../Service/Models/IContainer';
import { IDeviceLookup, IDeviceMessage } from '../Models/IRegistry';
import { IMasterAssetModel } from '../../Service/Models/IOPCUAPayload';
import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { EventEmitter } from 'events';
import { OPCUABuilder } from '../../Service/Utilities/OPCUABuilder/index';
import { ConformityValidator } from '../ConformityValidator';
import { Logger } from '../../Service/Utilities/Logger';
import { IConformity } from '../Models/IConformityValidator';
import { SequentialTaskQueue } from 'sequential-task-queue';

export class Registry extends EventEmitter {
  private applicationLookup: IDeviceLookup;
  private deviceLookup: IDeviceLookup;
  private registryClient: mqtt.AsyncClient;
  private globalEventList: IEventObject[];
  private builder: OPCUABuilder;
  private logger: Logger;
  private oi4DeviceWildCard: string;
  private appId: string;
  private queue: SequentialTaskQueue;

  // Timeout container
  private healthTimeout: number;

  private conformityValidator: ConformityValidator;

  constructor(logger: Logger, registryClient: mqtt.AsyncClient, appId: string = 'appIdRegistry') {
    super();
    this.logger = logger;
    this.queue = new SequentialTaskQueue();

    this.healthTimeout = 0;
    this.oi4DeviceWildCard = 'oi4/+/+/+/+/+';
    this.globalEventList = [];
    this.applicationLookup = {};
    this.deviceLookup = {};
    this.appId = appId;

    this.builder = new OPCUABuilder(appId); // TODO: Better system for appId!

    this.conformityValidator = new ConformityValidator(this.logger, appId); // TODO: Better system for appId!

    // Take registryClient from parameter Registry-MQTT-Client
    this.registryClient = registryClient;
    this.registryClient.on('message', this.processMqttMessage);
    this.registryClient.subscribe('oi4/+/+/+/+/+/pub/event/+/#');

    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/set/mam/#`); // Explicit "set"
    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/pub/mam/#`); // Add Asset to Registry
    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/del/mam/#`); // Delete Asset from Registry
    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/pub/health/#`); // Add Asset to Registry
    this.registryClient.subscribe('oi4/Registry/+/+/+/+/get/mam/#');
  }

  private processMqttMessage = async (topic: string, message: Buffer) => {
    const topicArr = topic.split('/');
    let firstPayload = { Messages:[] };
    try {
      firstPayload = JSON.parse(message.toString());
    } catch (e) {
      this.logger.log(`Registry: Error when parsing JSON in processMqttMessage: ${e}`);
      return;
    }
    const schemaResult = await this.builder.checkOPCUAJSONValidity(firstPayload);
    if (!schemaResult) {
      this.logger.log('Registry: Error in payload schema validation');
      return;
    }
    if (firstPayload.Messages.length === 0) {
      this.logger.log('Messages Array empty');
      return;
    }
    const parsedPayload = JSON.parse(message.toString()).Messages[0].Payload;
    const baseIdOffset = topicArr.length - 4;
    const oi4Id = `${topicArr[baseIdOffset]}/${topicArr[baseIdOffset + 1]}/${topicArr[baseIdOffset + 2]}/${topicArr[baseIdOffset + 3]}`;

    const topicArray = topic.split('/');
    const topicServiceType = topicArray[1];
    const topicAppId = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
    const topicMethod = topicArray[6];
    const topicResource = topicArray[7];
    const topicTag = topicArray.splice(8).join('/');

    let assetLookup: IDeviceLookup = {};
    if (oi4Id in this.applicationLookup) {
      assetLookup = this.applicationLookup;
    } else if (oi4Id in this.deviceLookup) {
      assetLookup = this.deviceLookup;
    }

    if (oi4Id in assetLookup) {
      assetLookup[oi4Id]['lastMessage'] = new Date().toISOString();
    }

    if (topic.includes('/pub/event')) { // we got an event that we are subscribed on
      // const logLevel = topicArr[8]; // If we don't save the logLevel in the payload, we can discard it
      if (oi4Id in assetLookup) {
        const eventList: any = assetLookup[oi4Id].eventList;
        if (eventList.length >= 3) {
          assetLookup[oi4Id].eventList.shift();
        }
        console.log('GOT EVENT FROM DEVICE!');
        assetLookup[oi4Id].eventList.push({
          ...parsedPayload,
        });
      }
      if (this.globalEventList.length >= 20) {
        this.globalEventList.shift();
      }
      this.globalEventList.push({
        ...parsedPayload,
        originId: oi4Id,
      });
    } else if (topic.includes('/pub/health')) {
      this.logger.log(`Registry: Got Health from ${oi4Id} in processMqttMessage`);
      if (oi4Id in assetLookup) {
        const health = assetLookup[oi4Id].resources.health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            this.logger.log('Registry: Resetting timeout from health');
            // This timeout will be called regardless of enable-setting. Every 60 seconds we need to manually poll health
            clearTimeout(this.healthTimeout);
            this.healthTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'health'), 60000);
          }
        }
        this.logger.log(`Registry: Setting health of ${oi4Id} to: ${JSON.stringify(parsedPayload)}`);
        parsedPayload.lastMessage = new Date().toISOString();
        assetLookup[oi4Id].resources.health = parsedPayload;
      } else {
        await this.registryClient.publish(`oi4/${topicServiceType}/${topicAppId}/get/mam/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, 'MamRegistry')));
        this.logger.log(`Registry: Got a health from unknown Asset, requesting mam on oi4/${topicServiceType}/${topicAppId}/get/mam/${oi4Id}`);
      }
    } else if (topic.includes('/pub/license')) {
      if (oi4Id in assetLookup) {
        assetLookup[oi4Id].resources.license = parsedPayload;
      }
    } else if (topic.includes('/pub/rtLicense')) {
      if (oi4Id in assetLookup) {
        assetLookup[oi4Id].resources.rtLicense = parsedPayload;
      }
    } else if (topic.includes('/pub/licenseText')) {
      if (oi4Id in assetLookup) {
        assetLookup[oi4Id].resources.licenseText = parsedPayload;
      }
    } else if (topic.includes('/pub/config')) {
      if (oi4Id in assetLookup) {
        assetLookup[oi4Id].resources.config = parsedPayload;
      }
    } else if (topic.includes('/pub/profile')) {
      if (oi4Id in assetLookup) {
        assetLookup[oi4Id].resources.profile = parsedPayload;
      }
    }
    if (topicAppId === this.appId) {
      switch (topicMethod) {
        case 'get': {
          switch (topicResource) {
            case 'mam': {
              this.sendOutMam(topicTag);
              break;
            }
            default: {
              break;
            }
          }
        }
        default: {
          break;
        }
      }
    } else {
      switch (topicMethod) {
        case 'get': {
          switch (topicResource) {
            case 'mam': {
              if (topicServiceType === 'Registry') {
                this.sendOutMam(topicTag);
              }
              break;
            }
            default: {
              break;
            }
          }
        }
        case 'pub': {
          switch (topicResource) {
            case 'mam': {
              this.addToRegistry({ topic, message: parsedPayload });
            }
          }
        }
        default: {
          break;
        }
      }
    }
  }

  /**
   * If we receive a pubMam Event from the MessageBusProxy, we check if that Mam is already in our Registry lookup
   * If not, we add it to the registry, if yes, we don't.
   */
  async addToRegistry(mqttObj: any) {
    const topicArr = mqttObj.topic.split('/');
    const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset
    if (this.getApplication(assetId) || this.getDevice(assetId)) {
      this.logger.log('Registry: MasterAssetModel already in Registry');
    } else {
      try {
        this.queue.push(async () => {
          return await this.addDevice(mqttObj.topic, mqttObj.message);
        });
      } catch (addErr) {
        this.logger.log(`Registry: Add-Error: ${addErr}`);
      }
    }
  }

  async addDevice(fullTopic: string, device: IMasterAssetModel) {
    this.logger.log(`------------- ADDING DEVICE -------------${fullTopic}`, 'w', 2);
    const topicArr = fullTopic.split('/');
    const originator = `${topicArr[2]}/${topicArr[3]}/${topicArr[4]}/${topicArr[5]}`; // This is the OI4-ID of the Orignator Container
    const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset
    const conf = await this.conformityValidator.checkConformity(`oi4/${topicArr[1]}/${originator}`, assetId);
    if (Object.keys(device).length === 0) {
      this.logger.log('Registry: Critical Error: MAM of device to be added is empty', 'w', 3);
    }
    const fullDevice: IDeviceMessage = {
      originator,
      appId: assetId,
      eventList: [],
      lastMessage: '',
      registeredAt: '',
      resources: {
        mam: device,
      },
      fullDevicePath: `oi4/${topicArr[1]}/${originator}`,
      conformityObject: conf,
    };
    let assetLookup: IDeviceLookup;
    if (device.HardwareRevision === '') {
      assetLookup = this.applicationLookup;
    } else {
      assetLookup = this.deviceLookup;
    }

    assetLookup[assetId] = fullDevice;

    // Subscribe to all changes regarding this application
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/health/${assetId}`);
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/license/${assetId}`);
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/rtLicense/${assetId}`);
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/licenseText/#`);
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/config/${assetId}`);
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/profile/${assetId}`);
    // Try to get them at least once!
    try {
      await this.getResourceFromDevice(assetId, 'health');
      assetLookup[assetId]['registeredAt'] = new Date().toISOString();
      assetLookup[assetId]['lastMessage'] = new Date().toISOString();
      // If too many devices onboard at the same time, the bus will get spammed...
      // await this.getResourceFromDevice(assetId, 'license');
      // await this.getResourceFromDevice(assetId, 'rtLicense');
      // await this.getResourceFromDevice(assetId, 'config');
      // await this.getResourceFromDevice(assetId, 'profile');

      const licenseObj = assetLookup[assetId].resources.license;
      if (licenseObj) {
        for (const licenses of licenseObj.licenses) {
          await this.getLicenseTextFromDevice(assetId, 'licenseText', licenses.licenseId);
        }
      }
    } catch (err) {
      console.log(err);
    }
    // Subscribe to events
    this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/event/+/${assetId}`);
  }

  /**
   * If we receive a getMam Event from the MessageBusProxy, we lookup the Mam in our Registry.
   * TODO: Currently, only an empty Tag is supported, which leads to a publish of ALL Mam Data on /pub/mam/<oi4Id>
   */
  async sendOutMam(tag: string) {
    if (tag === '') {
      const apps = this.applications as IDeviceLookup;
      const devices = this.devices as IDeviceLookup;
      const assets = Object.assign({}, apps, devices);
      this.logger.log(`Sending all known Mams...count: ${Object.keys(assets).length}`);
      for (const device of Object.keys(assets)) {
        // TODO: URL ENCODING???
        await this.registryClient.publish(`oi4/Registry/${this.appId}/pub/mam/${assets[device].resources.mam.ProductInstanceUri}`, JSON.stringify(this.builder.buildOPCUADataMessage(assets[device].resources.mam, new Date(), 'registryClassID')));
        this.logger.log(`Sent device with OI4-ID ${assets[device].resources.mam.ProductInstanceUri}`);
      }
    } else {
      this.logger.log(`Sending Mam with Requested tag: ${tag} <-- Not implemented!`);
    }
  }

  /**
   * Removes an asset from either the applicationLookup or the deviceLookup depending on where it's available
   * @param device - the oi4Id of the device that is to be removed
   */
  removeDevice(device: string) {
    if (device in this.applicationLookup) {
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/event/+/${device}`);
      delete this.applicationLookup[device];
      this.logger.log(`Registry: Deleted App: ${device}`, 'w', 2);
    } else if (device in this.deviceLookup) {
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/event/+/${device}`);
      delete this.deviceLookup[device];
      this.logger.log(`Registry: Deleted Device: ${device}`, 'r', 2);
    } else {
      this.logger.log('Registry: Nothing to remove here!');
    }
  }

  async updateConformityInDevice(oi4Id: string, resourceList: string[]): Promise<IConformity> {
    this.logger.log(`Registry: Checking conformity for ${oi4Id}`);
    let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
    if (oi4Id in this.applicationLookup) {
      conformityObject = await this.conformityValidator.checkConformity(this.applicationLookup[oi4Id].fullDevicePath, this.applicationLookup[oi4Id].appId, resourceList);
      this.applicationLookup[oi4Id].conformityObject = conformityObject;
    }
    if (oi4Id in this.deviceLookup) {
      conformityObject = await this.conformityValidator.checkConformity(this.deviceLookup[oi4Id].fullDevicePath, this.deviceLookup[oi4Id].appId, resourceList);
      this.deviceLookup[oi4Id].conformityObject = conformityObject;
    }
    return conformityObject;
  }

  async getResourceFromDevice(oi4Id: string, resource: string) {
    if (oi4Id in this.applicationLookup) {
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`)));
      this.logger.log(`Registry: Sent Get ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
    }
    if (oi4Id in this.deviceLookup) {
      await this.registryClient.publish(`${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`)));
      this.logger.log(`Registry: Sent Get ${resource} on ${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
    }
  }

  async getLicenseTextFromDevice(oi4Id: string, resource: string, license: string) {
    if (oi4Id in this.applicationLookup) {
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`)));
      this.logger.log(`Registry: Sent Get ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`);
    }
    if (oi4Id in this.deviceLookup) {
      await this.registryClient.publish(`${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`)));
      this.logger.log(`Registry: Sent Get ${resource} on ${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`);
    }
  }

  getResourceFromLookup(oi4Id: string, resource: string) {
    // TODO: Resource intensive, we should push to the error object only if we actually have an error
    // FIXME: Better yet, don't separate between device and application lookup
    const oi4ToObjectList: IDeviceMessage[] = [];
    if (oi4Id in this.applicationLookup) {
      oi4ToObjectList.push(this.applicationLookup[oi4Id]);
      if (resource === 'lastMessage' || resource === 'eventList') {
        if (resource in this.applicationLookup[oi4Id]) {
          return this.applicationLookup[oi4Id][resource];
        }
      }
      if ('resources' in this.applicationLookup[oi4Id]) {
        if (resource in this.applicationLookup[oi4Id].resources) {
          return this.applicationLookup[oi4Id].resources[resource];
        }
      }

    }
    if (oi4Id in this.deviceLookup) {
      oi4ToObjectList.push(this.deviceLookup[oi4Id]);
      if (resource === 'lastMessage' || resource === 'eventList') {
        if (resource in this.deviceLookup[oi4Id]) {
          return this.deviceLookup[oi4Id][resource];
        }
      }
      if ('resources' in this.deviceLookup[oi4Id]) {
        if (resource in this.deviceLookup[oi4Id].resources) {
          return this.deviceLookup[oi4Id].resources[resource];
        }
      }
    }
    return {
      err: 'Could not get resource from registry',
      foundObjects: oi4ToObjectList,
    };

  }

  getEventTrailFromDevice(oi4Id: string) {
    if (oi4Id in this.applicationLookup) {
      return this.applicationLookup[oi4Id].eventList;
    }
    if (oi4Id in this.deviceLookup) {
      return this.deviceLookup[oi4Id].eventList;
    }
    return {
      err: 'Could not get EventTrail from registry',
    };
  }

  get applications() {
    return this.applicationLookup;
  }

  get devices() {
    return this.deviceLookup;
  }

  getApplication(oi4Id: string) {
    if (oi4Id in this.applicationLookup) {
      return this.applicationLookup[oi4Id];
    }
  }

  getDevice(oi4Id: string) {
    if (oi4Id in this.deviceLookup) {
      return this.deviceLookup[oi4Id];
    }
  }

  get eventTrail() {
    return this.globalEventList;
  }
}
