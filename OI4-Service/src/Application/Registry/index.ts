import { IEventObject, EDeviceHealth, ESubResource, IDataSetClassIds } from '../../Service/Models/IContainer';
import { IDeviceLookup, IDeviceMessage, IRegistryConfig } from '../Models/IRegistry';
import EAuditLevel = ESubResource;
import { IMasterAssetModel, IOPCUAData } from '../../Service/Models/IOPCUAPayload';
import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { EventEmitter } from 'events';
import { OPCUABuilder } from '../../Service/Utilities/OPCUABuilder/index';
import { ConformityValidator } from '../ConformityValidator';
import { Logger } from '../../Service/Utilities/Logger';
import { IConformity } from '../Models/IConformityValidator';
import { SequentialTaskQueue } from 'sequential-task-queue';

// DSCIds
import dataSetClassIds = require('../../Config/dataSetClassIds.json'); /*tslint:disable-line*/
import { fstatSync, appendFileSync, openSync, closeSync, unlinkSync, readdirSync } from 'fs';
const dscids: IDataSetClassIds = <IDataSetClassIds>dataSetClassIds;

const rootdir = './logs';
let globIndex = 0;

export class Registry extends EventEmitter {
  private applicationLookup: IDeviceLookup;
  private deviceLookup: IDeviceLookup;
  private registryClient: mqtt.AsyncClient;
  private globalEventList: IEventObject[];
  private newEventList: IEventObject[];
  private builder: OPCUABuilder;
  private logger: Logger;
  private testLogger: Logger;
  private oi4DeviceWildCard: string;
  private appId: string;
  private queue: SequentialTaskQueue;
  private config: IRegistryConfig;
  private static auditList: EAuditLevel[] = [
    EAuditLevel.fatal,
    EAuditLevel.error,
    EAuditLevel.warn,
    EAuditLevel.info,
    EAuditLevel.debug,
    EAuditLevel.trace,
  ];
  private currentlyUsedFiles: string[];
  private currentlyUsedIndex: number;
  private currentFd: number;
  private fileCount: number;

  // Timeout container TODO: types
  private timeoutLookup: any;

  private conformityValidator: ConformityValidator;

  /**
   * The constructor of the Registry
   * @param registryClient The global mqtt client used to avoid multiple client connections inside the container
   * @param appId The appId used by the registry application for any kind of oi4-communication
   */
  constructor(registryClient: mqtt.AsyncClient, appId: string = 'appIdRegistry') {
    super();
    this.logger = new Logger(true, 'Registry-App', ESubResource.warn, registryClient, appId, 'Registry');
    this.testLogger = new Logger(false, 'Registry-TestApp', ESubResource.trace, registryClient, appId, 'Registry');
    setInterval(
      () => {
        globIndex = globIndex + 1;
        this.testLogger.log(globIndex.toString());
      },
      100);
    this.queue = new SequentialTaskQueue();

    this.timeoutLookup = {};
    this.oi4DeviceWildCard = 'oi4/+/+/+/+/+';
    this.globalEventList = [];
    this.newEventList = [];
    this.applicationLookup = {};
    this.deviceLookup = {};
    this.fileCount = 4;
    this.appId = appId;
    this.config = {
      logToFile: false,
      developmentMode: false,
      globalEventListLength: 100,
      assetEventListLength: 3, // Not used in backend, only frontend
      globalEventListSize: 200000, // In byte
      auditLevel: EAuditLevel.warn,
      showRegistry: true,
    }; // TODO: need solid model and good default values for this...

    this.currentlyUsedFiles = [];
    this.currentlyUsedIndex = 0;
    this.currentlyUsedFiles[this.currentlyUsedIndex] = `RegistryLog_${this.currentlyUsedIndex}_${Date.now().toString()}.reglog`;
    this.currentFd = 0;

    this.builder = new OPCUABuilder(appId, 'Registry'); // TODO: Better system for appId!

    this.conformityValidator = new ConformityValidator(appId); // TODO: Better system for appId!

    // Take registryClient from parameter Registry-MQTT-Client
    this.registryClient = registryClient;
    this.registryClient.on('message', this.processMqttMessage);
    for (const levels of Registry.auditList) {
      console.log(`subbed initially to ${levels}`);
      this.registryClient.subscribe(`oi4/+/+/+/+/+/pub/event/${levels}/#`);
    }

    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/set/mam/#`); // Explicit "set"
    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/pub/mam/#`); // Add Asset to Registry
    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/del/mam/#`); // Delete Asset from Registry
    this.registryClient.subscribe(`${this.oi4DeviceWildCard}/pub/health/#`); // Add Asset to Registry
    this.registryClient.subscribe('oi4/Registry/+/+/+/+/get/mam/#');

    // setInterval(() => { this.flushToLogfile; }, 60000);
  }

  private getFilesFromPath(path: string, extension: string) {
    const dir = readdirSync(path);
    return dir.filter(elm => elm.match(new RegExp(`.*\.(${extension})$`, 'ig')));
  }

  deleteFiles() { // As a safety measure, delete all files when we are changing fileSize
    const reglogArr = this.getFilesFromPath(rootdir, 'reglog');
    for (const reglogs of reglogArr) {
      try {
        console.log(`Deleting ${reglogs}`);
        unlinkSync(`${rootdir}/${reglogs}`); // Delete old file
      } catch (e) {
        if (e.code === 'ENOENT') {
          // That's ok, no need to delete a non-existing file
        } else {
          console.log(e);
        }
      }
    }
    return reglogArr;
  }

  private flushToLogfile() { // TODO: Change fileOperations to Async
    console.log('_____-------_______------FLUSH CALLED------______-----_____');
    if (this.config.logToFile) {
      console.log('log to file enabled');
      console.log(`${rootdir}/${this.currentlyUsedFiles[this.currentlyUsedIndex]}`);
      this.currentFd = openSync(`${rootdir}/${this.currentlyUsedFiles[this.currentlyUsedIndex]}`, 'a');
      let fsObj = fstatSync(this.currentFd);
      // console.log(fsObj);
      // console.log(fsObj.isFile());
      if (fsObj.size === 0) {
        appendFileSync(this.currentFd, '['); // Start of the file, open Array
        fsObj = fstatSync(this.currentFd);
      }
      if (fsObj.size >= (this.config.globalEventListSize / this.fileCount)) { // Size is bigger than an individual file may be
        for (const entries of this.globalEventList) { // Flush last entries... TODO: need to find a better way to do this instead of doubling the code
          if (fsObj.size !== 1) { // Only '[' in the file
            appendFileSync(this.currentFd, ','); // Separator between Objects
            appendFileSync(this.currentFd, JSON.stringify(entries, null, 2));
          } else {
            appendFileSync(this.currentFd, JSON.stringify(entries, null, 2));
            fsObj = fstatSync(this.currentFd);
          }

        }
        if (this.currentlyUsedIndex < this.fileCount - 1) { // Increment current file counter
          this.currentlyUsedIndex = this.currentlyUsedIndex + 1;
        } else {
          this.currentlyUsedIndex = 0; // Round trip
        }
        if (typeof this.currentlyUsedFiles[this.currentlyUsedIndex] !== 'undefined') { // Old file exists
          try {
            unlinkSync(`${rootdir}/${this.currentlyUsedFiles[this.currentlyUsedIndex]}`); // Delete old file
          } catch (e) {
            console.log('something went wrong with file deletion');
            if (e.code === 'ENOENT') {
              // That's ok, no need to delete a non-existing file
              this.logger.log('Trying to delete an already deleted files in flushToFile');
            } else {
              console.log(e);
            }
          }
        }
        this.currentlyUsedFiles[this.currentlyUsedIndex] = `RegistryLog_${this.currentlyUsedIndex}_${Date.now().toString()}.reglog`; // Set new filename, will be created with next openSync
        appendFileSync(this.currentFd, ']'); // Close Array
      } else {
        for (const entries of this.globalEventList) {
          if (fsObj.size !== 1) { // Only '[' in the file
            appendFileSync(this.currentFd, ','); // Separator between Objects
            appendFileSync(this.currentFd, JSON.stringify(entries, null, 2));
          } else {
            appendFileSync(this.currentFd, JSON.stringify(entries, null, 2));
            fsObj = fstatSync(this.currentFd);
          }

        }
      }
      closeSync(this.currentFd);
    }
  }

  /**
   * The main update callback for incoming registry-related mqtt messages
   * If an incoming message matches a registered asset, the values of that resource are taken from the payload and updated in the registry
   */
  private processMqttMessage = async (topic: string, message: Buffer) => {
    const topicArr = topic.split('/');
    let firstPayload = { Messages: [] };
    try {
      firstPayload = JSON.parse(message.toString());
    } catch (e) {
      this.logger.log(`Error when parsing JSON in processMqttMessage: ${e}`);
      return;
    }
    const schemaResult = await this.builder.checkOPCUAJSONValidity(firstPayload);
    if (!schemaResult) {
      this.logger.log('Error in payload schema validation');
      return;
    }
    if (firstPayload.Messages.length === 0) {
      this.logger.log('Messages Array empty');
      return;
    }
    const networkMessage: IOPCUAData = JSON.parse(message.toString());
    const parsedPayload = networkMessage.Messages[0].Payload;
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
      // console.log('Got Event!');
      console.log(`Length globEventList: ${this.globalEventList.length}`);
      if (this.globalEventList.length >= this.config.globalEventListLength) {
        // If we have too many elements in the list, we purge them
        this.flushToLogfile();
        this.globalEventList = [];
      }
      this.globalEventList.push({
        ...parsedPayload,
        Tag: oi4Id,
        Timestamp: networkMessage.Messages[0].Timestamp,
      });
      if (this.newEventList.length >= this.config.globalEventListLength) {
        // If we have too many elements in the list, we purge them
        for (let it = 0; it <= (this.globalEventList.length - this.config.globalEventListLength) + 1; it = it + 1) {
          this.newEventList.shift();
        }
      }
      this.newEventList.push({
        ...parsedPayload,
        Tag: oi4Id,
        Timestamp: networkMessage.Messages[0].Timestamp,
      });
    } else if (topic.includes('/pub/health')) {
      this.logger.log(`Got Health from ${oi4Id} in processMqttMessage`);
      if (oi4Id in assetLookup) {
        this.logger.log(`Resetting timeout from health for oi4Id: ${oi4Id}`);
        // This timeout will be called regardless of enable-setting. Every 60 seconds we need to manually poll health
        clearTimeout(this.timeoutLookup[oi4Id]);
        assetLookup[oi4Id].available = true; // We got a *health* message from the asset, so it's at least available
        const timeout = <any>setTimeout(() => this.resourceTimeout(oi4Id, 'health'), 65000);
        this.timeoutLookup[oi4Id] = timeout;
        this.logger.log(`Setting health of ${oi4Id} to: ${JSON.stringify(parsedPayload)}`);
        parsedPayload.lastMessage = new Date().toISOString();
        assetLookup[oi4Id].resources.health = parsedPayload;
      } else {
        await this.registryClient.publish(`oi4/${topicServiceType}/${topicAppId}/get/mam/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids.mam)));
        this.logger.log(`Got a health from unknown Asset, requesting mam on oi4/${topicServiceType}/${topicAppId}/get/mam/${oi4Id}`);
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
              this.logger.log('Someone requested a mam with out appId', ESubResource.debug);
              this.sendOutMam(topicTag);
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
    }
  }

  /**
   * If we receive a pubMam Event from the MessageBusProxy, we check if that Mam is already in our Registry lookup
   * If not, we add it to the registry, if yes, we don't.
   * @param mqttObj The full mqtt message containing a potential addition to the registry
   */
  async addToRegistry(mqttObj: any) {
    const topicArr = mqttObj.topic.split('/');
    const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset
    if (this.getApplication(assetId) || this.getDevice(assetId)) {
      this.logger.log('MasterAssetModel already in Registry');
    } else {
      try {
        this.logger.log('Enqueueing ADD-Device', ESubResource.debug);
        this.queue.push(async () => {
          return await this.addDevice(mqttObj.topic, mqttObj.message);
        });
      } catch (addErr) {
        this.logger.log(`Add-Error: ${addErr}`);
      }
    }
  }

  /**
   * Adds an asset based on the topic it registered on and its MasterAssetModel to the registry.
   * The asset is either classified into a device or an application
   * @param fullTopic The topic that contains information about the device being added
   * @param device The MasterAssetModel of the device
   */
  async addDevice(fullTopic: string, device: IMasterAssetModel) {
    this.logger.log(`------------- ADDING DEVICE -------------${fullTopic}`, ESubResource.debug);
    const topicArr = fullTopic.split('/');
    const originator = `${topicArr[2]}/${topicArr[3]}/${topicArr[4]}/${topicArr[5]}`; // This is the OI4-ID of the Orignator Container
    const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset

    if (this.getApplication(assetId) || this.getDevice(assetId)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
      this.logger.log('MasterAssetModel already in Registry - addDevice');
      return;
    }

    const conf = await this.conformityValidator.checkConformity(`oi4/${topicArr[1]}/${originator}`, assetId);
    if (Object.keys(device).length === 0) {
      this.logger.log('Critical Error: MAM of device to be added is empty', ESubResource.warn);
      return;
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
      available: true,
    };
    let assetLookup: IDeviceLookup;
    console.log(device);
    if (device.HardwareRevision === '') {
      assetLookup = this.applicationLookup;
      this.logger.log('___Adding Application___', ESubResource.debug);
    } else {
      assetLookup = this.deviceLookup;
      this.logger.log('___Adding Device___', ESubResource.debug);
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
      await this.updateResourceInDevice(assetId, 'health');
      await this.updateResourceInDevice(assetId, 'profile'); // Initial profile reading
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
    for (const levels of Registry.auditList) {
      console.log(`subbed local asset ${assetId} to ${levels}`);
      this.registryClient.subscribe(`${assetLookup[assetId].fullDevicePath}/pub/event/${levels}/${assetId}`);
      if (levels === this.config.auditLevel) {
        return;
      }
    }

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
        await this.registryClient.publish(`oi4/Registry/${this.appId}/pub/mam/${assets[device].resources.mam.ProductInstanceUri}`, JSON.stringify(this.builder.buildOPCUADataMessage(assets[device].resources.mam, new Date(), dscids.mam)));
        this.logger.log(`Sent device with OI4-ID ${assets[device].resources.mam.ProductInstanceUri}`);
      }
    } else {
      this.logger.log(`NOT IMPLEMENTED!: Sending Mam with Requested tag: ${tag}`);
    }
  }

  /**
   * Removes an asset from either the applicationLookup or the deviceLookup depending on where it's available
   * @param device - the oi4Id of the device that is to be removed
   */
  removeDevice(device: string) {
    if (device in this.applicationLookup) {
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/event/+/${device}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/health/${device}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/license/${device}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/rtLicense/${device}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/licenseText/#`);
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/config/${device}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[device].fullDevicePath}/pub/profile/${device}`);
      delete this.applicationLookup[device];
      this.logger.log(`Deleted App: ${device}`, ESubResource.info);
    } else if (device in this.deviceLookup) {
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/event/+/${device}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/health/${device}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/license/${device}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/rtLicense/${device}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/licenseText/#`);
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/config/${device}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[device].fullDevicePath}/pub/profile/${device}`);
      delete this.deviceLookup[device];
      this.logger.log(`Deleted Device: ${device}`, ESubResource.debug);
    } else {
      this.logger.log('Nothing to remove here!');
    }
  }

  /**
   * Clears the entire Registry by removing every asset from the applicationLookup and deviceLookup
   */
  clearRegistry() {
    for (const assets of Object.keys(this.applicationLookup)) { // Unsubscribe topics of every asset
      this.registryClient.unsubscribe(`${this.applicationLookup[assets].fullDevicePath}/pub/health/${assets}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[assets].fullDevicePath}/pub/license/${assets}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[assets].fullDevicePath}/pub/rtLicense/${assets}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[assets].fullDevicePath}/pub/licenseText/#`);
      this.registryClient.unsubscribe(`${this.applicationLookup[assets].fullDevicePath}/pub/config/${assets}`);
      this.registryClient.unsubscribe(`${this.applicationLookup[assets].fullDevicePath}/pub/profile/${assets}`);
    }
    this.applicationLookup = {}; // Clear application lookup

    for (const assets of Object.keys(this.deviceLookup)) { // Unsubscribe topics of every asset
      this.registryClient.unsubscribe(`${this.deviceLookup[assets].fullDevicePath}/pub/health/${assets}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[assets].fullDevicePath}/pub/license/${assets}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[assets].fullDevicePath}/pub/rtLicense/${assets}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[assets].fullDevicePath}/pub/licenseText/#`);
      this.registryClient.unsubscribe(`${this.deviceLookup[assets].fullDevicePath}/pub/config/${assets}`);
      this.registryClient.unsubscribe(`${this.deviceLookup[assets].fullDevicePath}/pub/profile/${assets}`);
    }
    this.deviceLookup = {}; // Clear device lookup
  }

  /**
   * Runs a conformity check on an asset by utilizing the ConformityValidator and returns the conformity Object.
   * @param oi4Id The oi4Id of the asset that is to be checked for conformity
   * @param resourceList The resourceList that is to be checked for conformity
   */
  async updateConformityInDevice(oi4Id: string, resourceList: string[]): Promise<IConformity> {
    this.logger.log(`Checking conformity for ${oi4Id}`);
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

  /**
   * Updates the resource of a registered asset by publishing a /get/ request on the corresponding oi4-topic
   * @param oi4Id The oi4Id of the asset that is to be updated
   * @param resource The resource that is to be updated
   */
  async updateResourceInDevice(oi4Id: string, resource: string) {
    if (oi4Id in this.applicationLookup) {
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids[resource])));
      this.logger.log(`Sent Get ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
    }
    if (oi4Id in this.deviceLookup) {
      await this.registryClient.publish(`${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids[resource])));
      this.logger.log(`Sent Get ${resource} on ${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
    }
  }

  /**
 * Updates the resource of a registered asset by publishing a /get/ request on the corresponding oi4-topic
 * @param oi4Id The oi4Id of the asset that is to be updated
 * @param resource The resource that is to be updated
 */
  async resourceTimeout(oi4Id: string, resource: string) {
    if (oi4Id in this.applicationLookup) {
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids[resource])));
      this.logger.log(`Registry:Timeout - Get ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
      this.applicationLookup[oi4Id].available = false; // We timeouted, it's not available for the moment...
    }
    if (oi4Id in this.deviceLookup) {
      await this.registryClient.publish(`${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids[resource])));
      this.logger.log(`Registry:Timeout - Get ${resource} on ${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${oi4Id}`);
      this.deviceLookup[oi4Id].available = false; // We timeouted, it's not available for the moment...
    }
    // this.healthTimeout = <any>setTimeout(() => this.updateResourceInDevice(oi4Id, 'health'), 65000); // Set new timeout, if we don't receive a health back...
  }

  /**
   * Updates the licenseText of a registered asset by publishing a /get/ request on the corresponding oi4-topic
   * @param oi4Id The oi4Id of the asset that is to be updated
   * @param resource The resource that is to be updated (in this case..licenseText)
   * @param license The license that is to be updated
   * TODO: merge this functionality into updateResourceInDevice by utilizing a default empty string parameter...
   */
  async getLicenseTextFromDevice(oi4Id: string, resource: string, license: string) {
    if (oi4Id in this.applicationLookup) {
      await this.registryClient.publish(`${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids[resource])));
      this.logger.log(`Sent Get ${resource} on ${this.applicationLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`);
    }
    if (oi4Id in this.deviceLookup) {
      await this.registryClient.publish(`${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`, JSON.stringify(this.builder.buildOPCUADataMessage({}, new Date, dscids[resource])));
      this.logger.log(`Sent Get ${resource} on ${this.deviceLookup[oi4Id].fullDevicePath}/get/${resource}/${license}`);
    }
  }

  /**
   * Retrieves a specific resource from an asset via its oi4Id. This includes devices and applications
   * @param oi4Id The oi4Id of the Asset that provides the resource
   * @param resource The name of the resource that needs to be retireved
   */
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

  /**
   * Updates the subscription of the audit trail to match the config
   * Attention. This clears all saved lists (global + assets)
   */
  async updateAuditLevel() {
    // First, clear all old eventLists
    this.globalEventList = [];
    for (const apps of Object.keys(this.applicationLookup)) {
      this.applicationLookup[apps].eventList = [];
    }
    for (const devices of Object.keys(this.deviceLookup)) {
      this.deviceLookup[devices].eventList = [];
    }

    // Then, unsubscribe from old Audit Trail
    for (const levels of Registry.auditList) {
      console.log(`unsubscribed ${levels}`);
      await this.registryClient.unsubscribe(`oi4/+/+/+/+/+/pub/event/${levels}/#`);
    }
    for (const devices of Object.keys(this.deviceLookup)) {
      this.unsubscribeAssetFromAudit(devices);
    }
    for (const apps of Object.keys(this.applicationLookup)) {
      this.unsubscribeAssetFromAudit(apps);
    }

    // Then, resubscribe to new Audit Trail
    for (const levels of Registry.auditList) {
      console.log(`subscribed ${levels}`);
      await this.registryClient.subscribe(`oi4/+/+/+/+/+/pub/event/${levels}/#`);
      if (levels === this.config.auditLevel) {
        return; // We matched our configured auditLevel, returning to not sub to redundant info...
      }
    }

    this.logger.level = this.config.auditLevel as ESubResource;
  }

  async unsubscribeAssetFromAudit(oi4Id: string) {
    console.log(`unsubbing all audits from ${oi4Id}`);
    if (oi4Id in this.applicationLookup) {
      for (const levels of Registry.auditList) {
        await this.registryClient.unsubscribe(`${this.applicationLookup[oi4Id].fullDevicePath}/pub/event/${levels}/${oi4Id}`);
      }
    }
    if (oi4Id in this.deviceLookup) {
      for (const levels of Registry.auditList) {
        await this.registryClient.unsubscribe(`${this.deviceLookup[oi4Id].fullDevicePath}/pub/event/${levels}/${oi4Id}`);
      }
    }
  }

  async resubscribeAssetFromAudit(oi4Id: string) {
    console.log(`resubbing all audits from ${oi4Id}`);
    if (oi4Id in this.applicationLookup) {
      for (const levels of Registry.auditList) {
        await this.registryClient.unsubscribe(`${this.applicationLookup[oi4Id].fullDevicePath}/pub/event/${levels}/${oi4Id}`);
        if (levels === this.config.auditLevel) {
          break;
        }
      }
    }
    if (oi4Id in this.deviceLookup) {
      for (const levels of Registry.auditList) {
        await this.registryClient.unsubscribe(`${this.deviceLookup[oi4Id].fullDevicePath}/pub/event/${levels}/${oi4Id}`);
        if (levels === this.config.auditLevel) {
          break;
        }
      }
    }
  }

  /**
   * Updates the config of the Registry
   * @param newConfig the new config object
   */
  async updateConfig(newConfig: IRegistryConfig) {
    const oldConf: IRegistryConfig = JSON.parse(JSON.stringify(this.config));
    this.config = JSON.parse(JSON.stringify(newConfig));
    if (oldConf.auditLevel !== newConfig.auditLevel) {
      this.logger.log(`auditLevel is different, updating from ${oldConf.auditLevel} to ${newConfig.auditLevel}`, ESubResource.debug);
      this.updateAuditLevel();
    }
    if (oldConf.globalEventListSize !== newConfig.globalEventListSize) { // fileSize changed!
      this.config.logToFile = false; // Temporarily disable logging
      this.logger.log(`fileSize for File-logging changed! (old: ${oldConf.globalEventListSize}, new: ${newConfig.globalEventListSize}) Deleting all old files and adjusting file`);
      this.deleteFiles();
      this.config.logToFile = newConfig.logToFile;
    }
  }

  /**
   * Retrieves the config of the Registry
   * @returns The config of the registry
   */
  getConfig(): IRegistryConfig {
    return this.config;
  }

  /**
   * Getter for applicationLookup
   * @returns {IDeviceLookup} The applicationLookup of the Registry
   */
  get applications() {
    return this.applicationLookup;
  }

  /**
   * Getter for deviceLookup
   * @returns {IDeviceLookup} The deviceLookup of the Registry
   */
  get devices() {
    return this.deviceLookup;
  }

  /**
   * Getter for globalEventList
   * @returns {IEventObject[]} The global event list of the Registry
   */
  get eventTrail() {
    return this.globalEventList;
  }

  /**
   * Retrieves a single application-asset by its appId
   * @param oi4Id The oi4Id of the asset that is to be retrieved
   */
  getApplication(oi4Id: string) {
    if (oi4Id in this.applicationLookup) {
      return this.applicationLookup[oi4Id];
    }
  }

  getAppId() {
    return this.appId;
  }

  /**
   * Retrieves a single device-asset by its appId
   * @param oi4Id The oi4Id of the asset that is to be retrieved
   */
  getDevice(oi4Id: string) {
    if (oi4Id in this.deviceLookup) {
      return this.deviceLookup[oi4Id];
    }
  }
}
