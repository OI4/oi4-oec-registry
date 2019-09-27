import { IAuditObject, EDeviceHealth } from '../../Service/Models/IContainer';
import { IDeviceLookup } from '../Models/IRegistry';
import { IMasterAssetModel, IOPCUAData } from '../../Service/Models/IOPCUAPayload';
import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { EventEmitter } from 'events';
import os from 'os';
const { promiseTimeout } = require('../../Service/Utilities/Timeout/index');
import { OPCUABuilder } from '../../Service/Utilities/OPCUABuilder/index';
import { Logger } from '../../Service/Utilities/Logger';

interface TMqttOpts {
  clientId: string;
  servers: object[];
  will?: object;
}

export class Registry extends EventEmitter {
  private applicationLookup: IDeviceLookup;
  private deviceLookup: IDeviceLookup;
  private registryClient: mqtt.AsyncClient;
  private globalAuditList: IAuditObject[];
  private builder: OPCUABuilder;
  private logger: Logger;

  // Individual timeouts
  private healthTimeout: number;
  private licenseTimeout: number;
  private rtLicenseTimeout: number;
  private licenseTextTimeout: number;
  private configTimeout: number;
  private profileTimeout: number;
  constructor(logger: Logger) {
    super();
    this.logger = logger;

    this.healthTimeout = 0;
    this.licenseTimeout = 0;
    this.rtLicenseTimeout = 0;
    this.licenseTextTimeout = 0;
    this.configTimeout = 0;
    this.profileTimeout = 0;

    this.globalAuditList = [];
    this.applicationLookup = {};
    this.deviceLookup = {};

    this.builder = new OPCUABuilder('appIdRegistry'); // TODO: Better system for appId!

    // Instantiate Registry-MQTT-Client
    const serverObj = {
      host: process.env.OI4_ADDR as string,
      port: parseInt(process.env.OI4_PORT as string, 10),
    };

    const mqttOpts: TMqttOpts = {
      clientId: `Registry${os.hostname()}`,
      servers: [serverObj],
    };
    this.registryClient = mqtt.connect(mqttOpts);

    this.registryClient.on('connect', (connack: mqtt.IConnackPacket) => {
      console.log('Registry: Connected to broker!');
      this.registryClient.on('message', this.processMqttMessage);
    });

    this.registryClient.subscribe('oi4/+/+/+/+/+/pub/event/+/#');
  }

  private processMqttMessage = (topic: string, message: Buffer) => {
    const topicArr = topic.split('/');
    const parsedPayload = JSON.parse(message.toString()).Messages[0].Payload;
    if (topic.includes('/pub/event')) { // we got an event that we are subscribed on
      // const logLevel = topicArr[8]; // If we don't save the logLevel in the payload, we can discard it
      const oi4Id = `${topicArr[9]}/${topicArr[10]}/${topicArr[11]}/${topicArr[12]}`;
      if (oi4Id in this.applicationLookup) {
        const auditList: any = this.applicationLookup[oi4Id].auditList;
        if (auditList.length >= 3) {
          this.applicationLookup[oi4Id].auditList.shift();
        }
        this.applicationLookup[oi4Id].auditList.push({
          ...parsedPayload,
        });
      }
      if (this.globalAuditList.length >= 30) {
        this.globalAuditList.shift();
      }
      this.globalAuditList.push({
        ...parsedPayload,
        originId: oi4Id,
      });
    } else if (topic.includes('/pub/health')) {
      const oi4Id = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`;
      this.logger.log(`Registry: Got Health from ${oi4Id}`);
      if (oi4Id in this.applicationLookup) {
        const health = this.applicationLookup[oi4Id].health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            this.logger.log('Resetting timeout from health');
            clearTimeout(this.healthTimeout);
            this.healthTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'health'), 10000);
          } else if (health.health === EDeviceHealth.FAILURE_1) {
            if (parsedPayload.health === EDeviceHealth.NORMAL_0) {
              this.logger.log('Resetting timeout from ALL');
              clearTimeout(this.healthTimeout);
              this.healthTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'health'), 10000);
              clearTimeout(this.licenseTimeout);
              this.licenseTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'license'), 10000);
              clearTimeout(this.rtLicenseTimeout);
              this.rtLicenseTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'rtLicense'), 10000);
              clearTimeout(this.licenseTextTimeout);
              this.licenseTextTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'licenseText'), 10000);
              clearTimeout(this.configTimeout);
              this.configTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'config'), 10000);
            }
          }
        }
        this.logger.log(`Registry: Setting health of ${oi4Id} to: ${JSON.stringify(parsedPayload)}`);
        parsedPayload.lastMessage = new Date().toISOString();
        this.applicationLookup[oi4Id].health = parsedPayload;
      }
    } else if (topic.includes('/pub/license')) {
      const oi4Id = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`;
      if (oi4Id in this.applicationLookup) {
        const health = this.applicationLookup[oi4Id].health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            clearTimeout(this.licenseTimeout);
            this.licenseTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'license'), 10000);
          }
        }
        this.applicationLookup[oi4Id].license = parsedPayload;
      }
    } else if (topic.includes('/pub/rtLicense')) {
      const oi4Id = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`;
      if (oi4Id in this.applicationLookup) {
        const health = this.applicationLookup[oi4Id].health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            clearTimeout(this.rtLicenseTimeout);
            this.rtLicenseTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'rtLicense'), 10000);
          }
        }
        this.applicationLookup[oi4Id].rtLicense = parsedPayload;
      }
    } else if (topic.includes('/pub/licenseText')) {
      const oi4Id = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`;
      if (oi4Id in this.applicationLookup) {
        const health = this.applicationLookup[oi4Id].health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            clearTimeout(this.licenseTextTimeout);
            this.licenseTextTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'licenseText'), 10000);
          }
        }
        this.applicationLookup[oi4Id].licenseText = parsedPayload;
      }
    } else if (topic.includes('/pub/config')) {
      const oi4Id = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`;
      if (oi4Id in this.applicationLookup) {
        const health = this.applicationLookup[oi4Id].health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            clearTimeout(this.configTimeout);
            this.configTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'config'), 10000);
          }
        }
        this.applicationLookup[oi4Id].config = parsedPayload;
      }
    } else if (topic.includes('/pub/profile')) {
      const oi4Id = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`;
      if (oi4Id in this.applicationLookup) {
        const health = this.applicationLookup[oi4Id].health;
        if (health) {
          if (health.health === EDeviceHealth.NORMAL_0) {
            clearTimeout(this.profileTimeout);
            this.profileTimeout = <any>setTimeout(() => this.getResourceFromDevice(oi4Id, 'profile'), 10000);
          }
        }
        this.applicationLookup[oi4Id].profile = parsedPayload;
      }
    }
  }

  async addDevice(fullTopic: string, device: IMasterAssetModel) {
    const fullDevice = {
      ...device,
      auditList: [],
    };
    this.logger.log(`------------- ADDING DEVICE -------------${fullTopic}`);
    const topicArr = fullTopic.split('/');
    const originator = `${topicArr[2]}/${topicArr[3]}/${topicArr[4]}/${topicArr[5]}`; // This is the OI4-ID of the Orignator Container
    const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset
    if (device.HardwareRevision === '') { // We've got a piece of software here, which is able to provide health, license etc.
      this.applicationLookup[assetId] = fullDevice;
      this.applicationLookup[assetId].fullDevicePath = `oi4/${topicArr[1]}/${assetId}`;

      // Subscribe to all changes regarding this application
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/health/${assetId}`);
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/license/${assetId}`);
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/rtLicense/${assetId}`);
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/licenseText/#`);
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/config/${assetId}`);
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/profile/${assetId}`);
      // Try to get them at least once!
      try {
        await this.getResourceFromDevice(assetId, 'health');
        this.applicationLookup[assetId]['registeredAt'] = new Date().toISOString();
        <any>setTimeout(() => this.getResourceFromDevice(assetId, 'health'), 10000); // Trigger cyclic retrieval
        await this.getResourceFromDevice(assetId, 'license');
        <any>setTimeout(() => this.getResourceFromDevice(assetId, 'license'), 10000);
        await this.getResourceFromDevice(assetId, 'rtLicense');
        <any>setTimeout(() => this.getResourceFromDevice(assetId, 'rtLicense'), 10000);
        await this.getResourceFromDevice(assetId, 'config');
        <any>setTimeout(() => this.getResourceFromDevice(assetId, 'config'), 10000);
        await this.getResourceFromDevice(assetId, 'profile');
        <any>setTimeout(() => this.getResourceFromDevice(assetId, 'profile'), 10000);
        const licenseObj = this.applicationLookup[assetId].license;
        if (licenseObj) {
          for (const licenses of licenseObj.licenses) {
            await this.getLicenseTextFromDevice(assetId, 'licenseText', licenses.licenseId);
            <any>setTimeout(() => this.getLicenseTextFromDevice(assetId, 'licenseText', licenses.licenseId), 10000);
          }
        }
      } catch (err) {
        console.log(err);
      }
      // Subscribe to events
      this.registryClient.subscribe(`${this.applicationLookup[assetId].fullDevicePath}/pub/event/+/${assetId}`);

    } else { // This is probably a hardware-sensor or device, just add it in the table, possibly with the provider!
      const origDevice = {
        ...fullDevice,
        originator,
      };
      this.deviceLookup[assetId] = origDevice;
    }

  }

  removeDevice(device: string) {
    if (device in this.applicationLookup) {
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/event/+/${device}`);
      delete this.applicationLookup[device];
      this.logger.log(`Registry: Deleted App: ${device}`);
    } else if (device in this.deviceLookup) {
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/event/+/${device}`);
      delete this.deviceLookup[device];
      this.logger.log(`Registry: Deleted Device: ${device}`);
    }
  }

  async getResourceFromDevice(oi4Id: string, resource: string) {
    if (oi4Id in this.applicationLookup) {
      // if (resource in this.applicationLookup[oi4Id]) {
      //   return this.applicationLookup[oi4Id][resource];
      // }
      this.registryClient.once('message', async (topic, rawMsg) => {
        if (topic === `${this.applicationLookup[oi4Id].fullDevicePath}/pub/${resource}/${oi4Id}`) {
          const parsedMessage: IOPCUAData = JSON.parse(rawMsg.toString());
          const parsedPayload = parsedMessage.Messages[0].Payload;
          this.emit(`Registry${resource}${oi4Id}Success`, parsedPayload); // God knows how many hours I wasted here! We send the OI4ID with the success emit
          // This way, ONLY the corresponding Conformity gets updated!
        }
      });
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`)));
      this.logger.log(`Registry: Getting ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
      try {
        return await promiseTimeout(new Promise((resolve, reject) => {
          this.once(`Registry${resource}${oi4Id}Success`, (resourcePayload) => {
            let resPayload;
            if (resource === 'health') {
              resPayload = {
                ...resourcePayload,
                lastMessage: new Date().toISOString(),
              };
            } else {
              resPayload = resourcePayload;
            }
            this.applicationLookup[oi4Id][resource] = resPayload;
            resolve(this.applicationLookup[oi4Id][resource]);
          });
        }),
          1000, /*tslint:disable-line*/
          `${resource}Error`, /*tslint:disable-line*/
        );
      } catch (promErr) {
        this.logger.log(`Registry: Error: ${promErr} in GetResource with Resource ${resource}`);
        return { err: 'ERROR, Timeout error' };
      }
    }
  }

  async getLicenseTextFromDevice(oi4Id: string, resource: string, license: string) {
    if (oi4Id in this.applicationLookup) {
      // if (resource in this.applicationLookup[oi4Id]) {
      //   return this.applicationLookup[oi4Id][resource];
      // }
      this.registryClient.once('message', async (topic, rawMsg) => {
        if (topic === `${this.applicationLookup[oi4Id].fullDevicePath}/pub/${resource}/${license}`) {
          const parsedMessage: IOPCUAData = JSON.parse(rawMsg.toString());
          const parsedPayload = parsedMessage.Messages[0].Payload;
          this.emit(`Registry${resource}${oi4Id}Success`, parsedPayload); // God knows how many hours I wasted here! We send the OI4ID with the success emit
          // This way, ONLY the corresponding Conformity gets updated!
        }
      });
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`, JSON.stringify(this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`)));
      this.logger.log(`Registry: Getting ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`);
      try {
        return await promiseTimeout(new Promise((resolve, reject) => {
          this.once(`Registry${resource}${oi4Id}Success`, (resourcePayload) => {
            this.applicationLookup[oi4Id][resource] = resourcePayload;
            this.logger.log(`Registry: Success in GetResource with Resource ${resource}`);
            resolve(this.applicationLookup[oi4Id][resource]);
          });
        }),
          1100, /*tslint:disable-line*/
          `${resource}Error`, /*tslint:disable-line*/
        );
      } catch (promErr) {
        this.logger.log(`Registry: Error: ${promErr} in GetResource with Resource ${resource}`);
        return { err: 'ERROR, Timeout error' };
      }
    }
  }

  getResourceFromLookup(oi4Id: string, resource: string) {
    if (oi4Id in this.applicationLookup) {
      return this.applicationLookup[oi4Id][resource];
    }
    return {
      err: 'Could not get resource from registry',
    };
  }

  getAuditTrailFromDevice(oi4Id: string) {
    if (oi4Id in this.applicationLookup) {
      return this.applicationLookup[oi4Id].auditList;
    }
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

  get auditTrail() {
    return this.globalAuditList;
  }
}
