import mqtt = require('async-mqtt'); /*tslint:disable-line*/
// DSCIds
import {EventEmitter} from 'events';
import {SequentialTaskQueue} from 'sequential-task-queue';
import {
    CDataSetWriterIdLookup,
    EDeviceHealth,
    EGenericEventFilter,
    ENamurEventFilter,
    EOpcUaEventFilter,
    PublicationListConfig,
    SubscriptionListConfig,
    ESyslogEventFilter,
    IOI4ApplicationResources,
    ISpecificContainerConfig,
    Health,
    PublicationList,
    SubscriptionList,
    Resource,
    EAssetType,
    DataSetClassIds
} from '@oi4/oi4-oec-service-model';
import {
    EOPCUAStatusCode,
    IMasterAssetModel,
    IOPCUANetworkMessage,
    IOPCUADataSetMessage,
    OPCUABuilder    
} from '@oi4/oi4-oec-service-opcua-model';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {FileLogger, OI4ApplicationResources} from '@oi4/oi4-oec-service-node';
import {ConformityValidator, IConformity} from '@oi4/oi4-oec-service-conformity-validator';
import {IAssetLookup, IAsset, IEventObject} from '../Models/IRegistry';


export class Registry extends EventEmitter {
    private assetLookup: IAssetLookup;
    private registryClient: mqtt.AsyncClient;
    private globalEventList: IEventObject[];
    private builder: OPCUABuilder;
    private logger: Logger;
    private readonly oi4DeviceWildCard: string;
    private readonly oi4Id: string;
    private queue: SequentialTaskQueue;
    private logToFileEnabled: string; // TODO: Should be a bool, but we use strings as enums...
    private logHappened: boolean;
    private readonly applicationResources: OI4ApplicationResources;
    private readonly maxAuditTrailElements: number;
    private fileLogger: FileLogger;

    private flushTimeout: any;

    // Timeout container TODO: types
    private readonly timeoutLookup: any;
    private readonly secondStageTimeoutLookup: any;
    private conformityValidator: ConformityValidator;

    /**
     * The constructor of the Registry
     * @param registryClient The global mqtt client used to avoid multiple client connections inside the container
     * @param appResources The containerState of the OI4-Service holding information about the oi4Id etc.
     */
    constructor(registryClient: mqtt.AsyncClient, appResources: IOI4ApplicationResources) {
        super();
        this.oi4Id = appResources.oi4Id;
        const specificConfig = appResources.config as ISpecificContainerConfig; // TODO cfz verify that cast is ok 
        this.logToFileEnabled = specificConfig.logging.logType.value;
        // Config section
        appResources.on('newConfig', (oldConfig: ISpecificContainerConfig) => {
            const newConfig = specificConfig;
            if (newConfig.logging.logType.value === 'enabled') {
                this.flushTimeout = setTimeout(() => this.flushToLogfile(), 60000);
            }
            if (oldConfig.logging.auditLevel.value !== newConfig.logging.auditLevel.value) {
                this.logger.log(`auditLevel is different, updating from ${oldConfig.logging.auditLevel.value} to ${newConfig.logging.auditLevel.value}`, ESyslogEventFilter.debug);
                this.updateAuditLevel();
            }
            if (oldConfig.logging.logFileSize.value !== newConfig.logging.logFileSize.value) { // fileSize changed!
                this.logToFileEnabled = 'disabled'; // Temporarily disable logging
                this.logger.log(`fileSize for File-logging changed! (old: ${oldConfig.logging.logFileSize.value}, new: ${newConfig.logging.logFileSize.value}) Deleting all old files and adjusting file`);
                this.deleteFiles();
                this.logToFileEnabled = newConfig.logging.logType.value;
            }
        });
        // @ts-ignore: TODO: not assignable message...fix it
        this.logger = new Logger(true, 'Registry-App', process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter, registryClient, this.oi4Id, 'Registry');
        this.fileLogger = new FileLogger(parseInt(specificConfig.logging.logFileSize.value));

        this.queue = new SequentialTaskQueue();
        this.applicationResources = <OI4ApplicationResources>appResources;

        this.timeoutLookup = {};
        this.secondStageTimeoutLookup = {};
        this.oi4DeviceWildCard = 'oi4/+/+/+/+/+';
        this.globalEventList = [];
        this.assetLookup = {};
        this.maxAuditTrailElements = 100;
        this.logHappened = false;

        this.builder = new OPCUABuilder(this.oi4Id, 'Registry'); // TODO: Better system for oi4Id!

        this.conformityValidator = new ConformityValidator(this.oi4Id, registryClient); // TODO: Better system for oi4Id!

        // Take registryClient from parameter Registry-MQTT-Client
        this.registryClient = registryClient;
        this.registryClient.on('message', this.processMqttMessage);
        // Subscribe to generic events
        for (const levels of Object.values(EGenericEventFilter)) {
            console.log(`Subbed initially to generic category - ${levels}`);
            this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/generic/${levels}/#`);
        }
        // Subscribe to namur events
        for (const levels of Object.values(ENamurEventFilter)) {
            console.log(`Subbed initially to namur category - ${levels}`);
            this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/ne107/${levels}/#`);
        }
        // Subscribe to syslog events
        for (const levels of Object.values(ESyslogEventFilter)) {
            console.log(`Subbed initially to syslog category - ${levels}`);
            this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/syslog/${levels}/#`);
        }
        // Subscribe to OPCUA events
        for (const levels of Object.values(EOpcUaEventFilter)) {
            console.log(`Subbed initially to syslog category - ${levels}`);
            this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/opcSC/${levels}/#`);
        }

        this.ownSubscribe(`${this.oi4DeviceWildCard}/set/mam/#`); // Explicit "set"
        this.ownSubscribe(`${this.oi4DeviceWildCard}/pub/mam/#`); // Add Asset to Registry
        this.ownSubscribe(`${this.oi4DeviceWildCard}/del/mam/#`); // Delete Asset from Registry
        this.ownSubscribe(`${this.oi4DeviceWildCard}/pub/health/#`); // Add Asset to Registry
        this.ownSubscribe('oi4/Registry/+/+/+/+/get/mam/#');

        // setInterval(() => { this.flushToLogfile; }, 60000); // TODO: Re-enable
    }

    /**
     * Overrides the default mqtt-subscription in order to automatically adjust the 'subscriptionList' resource
     * @param topic - The topic that should be subscribed to
     */
    private async ownSubscribe(topic: string) {

        const subscription = new SubscriptionList();
        subscription.topicPath = topic;
        subscription.config = SubscriptionListConfig.NONE_0;
        subscription.interval = 0;

        this.applicationResources.addSubscription(subscription);
        return await this.registryClient.subscribe(topic);
    }

    /**
     * Overrides the default mqtt-unsubscription in order to automatically adjust the 'subscriptionList' resource
     * @param topic - The topic that should be unsubscribed from
     */
    private async ownUnsubscribe(topic: string) {
        // Remove from subscriptionList
        this.removeSubscriptionByTopic(topic);
        return await this.registryClient.unsubscribe(topic);
    }

    private removeSubscriptionByTopic(topic: string): void
    {
        // TODO cfz find a better way to remove the subscription list 
        
        for (let i=0; i < this.applicationResources.subscriptionList.length; i++)
        {
            if (this.applicationResources.subscriptionList[i].topicPath == topic)
            {
                this.applicationResources.subscriptionList.splice(i--, 1)
            }
        }
    }

    /**
     * Wrapper function for the File-Logger flushToFile. Behaviour:
     * If logging is not enabled, we skip flushing to file and instead shift the array (in order not to overfill the rambuffer)
     * If it's enabled and no logs happened, we can simply return and re-set the timeout (no need to shift since the array should be empty)
     */
    private flushToLogfile() {
        if (this.logToFileEnabled === 'enabled') {
            if (!this.logHappened) {
                console.log('no logs happened in the past minute... returning...');
                this.flushTimeout = setTimeout(() => this.flushToLogfile(), 60000);
                return;
            }
            this.logger.log('Filelogger enable --- calling flushToLogfile', ESyslogEventFilter.warning);
            this.fileLogger.flushToLogfile(this.globalEventList);
            this.globalEventList = []; // We flushed the logs, so we can clear our rambuffer
            this.logHappened = false;
            this.flushTimeout = setTimeout(() => this.flushToLogfile(), 60000);
        } else {
            // If we have too many elements in the list, we purge them so we can add new ones
            for (let it = 0; it <= (this.globalEventList.length - this.maxAuditTrailElements) + 1; it = it + 1) {
                this.globalEventList.shift();
            }
        }
    }

    // TODO cfz: See also MqttMessageProcessor in oi4-oec-service-node/src/Utilities/Helpers/
    /**
     * The main update callback for incoming registry-related mqtt messages
     * If an incoming message matches a registered asset, the values of that resource are taken from the payload and updated in the registry
     */
    private processMqttMessage = async (topic: string, message: Buffer) => {
        const topicArr = topic.split('/');
        let parsedMessage: IOPCUANetworkMessage;
        try {
            parsedMessage = JSON.parse(message.toString());
        } catch (e) {
            this.logger.log(`Error when parsing JSON in processMqttMessage: ${e}`, ESyslogEventFilter.warning);
            this.logger.log(`Topic: ${topic}`, ESyslogEventFilter.warning);
            this.logger.log(message.toString(), ESyslogEventFilter.warning);
            return;
        }
        let schemaResult = false;
        try {
            schemaResult = await this.builder.checkOPCUAJSONValidity(parsedMessage);
        } catch (e) {
            if (typeof e === 'string') {
                this.logger.log(e, ESyslogEventFilter.warning);
            }
        }
        if (!schemaResult) {
            this.logger.log('Error in pre-check (crash-safety) schema validation, please run asset through conformity validation or increase logLevel', ESyslogEventFilter.warning);
            return;
        }

        const networkMessage: IOPCUANetworkMessage = JSON.parse(message.toString()); // TODO cfz performance: message is already parsed above 
        const baseIdOffset = topicArr.length - 4;
        const oi4Id = `${topicArr[baseIdOffset]}/${topicArr[baseIdOffset + 1]}/${topicArr[baseIdOffset + 2]}/${topicArr[baseIdOffset + 3]}`;

        let parsedPayload: any = {}; // FIXME: Hotfix, remove the "any" and see where it goes...
        if (networkMessage.Messages.length !== 0) {
            parsedPayload = networkMessage.Messages[0].Payload;
        }

        const topicArray = topic.split('/');
        const topicServiceType = topicArray[1];
        const topicAppId = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
        const topicMethod = topicArray[6];
        const topicResource = topicArray[7];
        const topicFilter = topicArray.splice(8).join('/');

        // Safety-Check: DataSetClassId
        if (networkMessage.DataSetClassId !== DataSetClassIds[topicResource]) {
            this.logger.log(`Error in pre-check, dataSetClassId mismatch, got ${networkMessage.DataSetClassId}, expected ${DataSetClassIds[topicResource]}`, ESyslogEventFilter.warning);
            return;
        }

        if (topicMethod === 'pub' && parsedMessage.Messages.length === 0) { // In pub, we do not expect empty messages, they always need at least one entry
            this.logger.log('Messages Array empty in pub - check DataSetMessage format', ESyslogEventFilter.warning);
            return;
        }

        if (oi4Id in this.assetLookup) { // If we've got this oi4Id in our lookup, we update its "life-sign", even if the payload might be wrong later on
            this.assetLookup[oi4Id]['lastMessage'] = new Date().toISOString();
        }

        if (topic.includes('/pub/event')) { // we got an event that we are subscribed on
            // console.log('Got Event!');
            this.logHappened = true; // We got some form of logs
            // console.log(`Length globEventList: ${this.globalEventList.length}`);
            if (this.globalEventList.length >= this.maxAuditTrailElements) {
                // If we have too many elements in the list, we purge them
                clearTimeout(this.flushTimeout);
                this.flushToLogfile(); // This will also shift the array if there are too many entries!
            }
            this.globalEventList.push({ // So we have space for this payload!
                ...parsedPayload,
                level: topicFilter.split('/')[1],
                timestamp: networkMessage.Messages[0].Timestamp,
                tag: topicAppId,
            });
        } else if (topic.includes('/pub/health')) {
            this.logger.log(`Got Health from ${oi4Id} in processMqttMessage`);
            if (oi4Id in this.assetLookup) {
                this.logger.log(`Resetting timeout from health for oi4Id: ${oi4Id}`, ESyslogEventFilter.warning);
                // This timeout will be called regardless of enable-setting. Every 60 seconds we need to manually poll health
                clearTimeout(this.timeoutLookup[oi4Id]);
                clearTimeout(this.secondStageTimeoutLookup[oi4Id]);

                if (parsedPayload.health === EDeviceHealth.FAILURE_1 && parsedPayload.healthState === 0) {
                    this.logger.log(`Kill-Message detected in Asset: ${oi4Id}, setting availability to false.`, ESyslogEventFilter.warning);
                    this.assetLookup[oi4Id].available = false;
                } else {
                    this.assetLookup[oi4Id].available = true; // We got a *health* message from the asset, so it's at least available
                    const timeout = <any>setTimeout(() => this.resourceTimeout(oi4Id, Resource.HEALTH), 65000);
                    this.timeoutLookup[oi4Id] = timeout;
                }

                this.logger.log(`Setting health of ${oi4Id} to: ${JSON.stringify(parsedPayload)}`);
                parsedPayload.lastMessage = new Date().toISOString();
                this.assetLookup[oi4Id].resources.health = parsedPayload;
            } else {
                if (topicAppId === this.oi4Id) return;

                const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[Resource.MAM]);
                await this.registryClient.publish(`oi4/${topicServiceType}/${topicAppId}/get/mam/${oi4Id}`, JSON.stringify(networkMessage));
                this.logger.log(`Got a health from unknown Asset, requesting mam on oi4/${topicServiceType}/${topicAppId}/get/mam/${oi4Id}`, ESyslogEventFilter.debug);
            }
        } else if (topic.includes('/pub/license')) {
            if (oi4Id in this.assetLookup) {
                this.assetLookup[oi4Id].resources.license = parsedPayload;
            }
        } else if (topic.includes('/pub/rtLicense')) {
            if (oi4Id in this.assetLookup) {
                this.assetLookup[oi4Id].resources.rtLicense = parsedPayload;
            }
        } else if (topic.includes('/pub/licenseText')) {
            if (oi4Id in this.assetLookup) {
                this.assetLookup[oi4Id].resources.licenseText = parsedPayload;
            }
        } else if (topic.includes('/pub/config')) {
            if (oi4Id in this.assetLookup) {
                this.assetLookup[oi4Id].resources.config = parsedPayload;
            }
        } else if (topic.includes('/pub/profile')) {
            if (oi4Id in this.assetLookup) {
                this.assetLookup[oi4Id].resources.profile = parsedPayload;
            }
        }
        if (topicAppId === this.oi4Id) {
            switch (topicMethod) {
                case 'get': {
                    let payloadType = 'empty';
                    let page = 0;
                    let perPage = 0;

                    if (parsedMessage.Messages.length !== 0) {
                        for (const messages of parsedMessage.Messages) {
                            payloadType = await this.builder.checkPayloadType(messages.Payload);
                            if (payloadType === 'locale') {
                                this.logger.log('Detected a locale request, but we can only send en-US!', ESyslogEventFilter.informational);
                            }
                            if (payloadType === 'pagination') {
                                page = messages.Payload.page;
                                perPage = messages.Payload.perPage;
                                if (page === 0 || perPage === 0) {
                                    this.logger.log('Pagination requested either page or perPage 0, aborting send...');
                                    return;
                                }
                            }
                            if (payloadType === 'none') { // Not empty, locale or pagination
                                this.logger.log('Message must be either empty, locale or pagination type in a /get/ request. Aboring get operation.', ESyslogEventFilter.informational);
                                return;
                            }
                        }
                    }

                    switch (topicResource) {
                        case 'mam': {
                            this.logger.log('Someone requested a mam with our oi4Id as appId', ESyslogEventFilter.debug);
                            if (topicFilter.includes('Registry')) break; // TODO cfz This request should be handled in the service component
                            this.sendOutMam(topicFilter, page, perPage);
                            break;
                        }
                        case 'health': {
                            this.logger.log('Someone requested a health with our oi4Id as appId', ESyslogEventFilter.debug);
                            if (topicFilter.includes('Registry')) break; // TODO cfz This request should be handled in the service component
                            this.sendOutHealth(topicFilter, page, perPage);
                        }
                        default: {
                            break;
                        }
                    }
                    break;
                }
                case 'pub': {
                    switch (topicResource) {
                        case 'mam': {
                            if (topicArr.length > 9) {
                                // TODO cfz: support for mam that contains all assets of an application?
                                this.addToRegistry(topic, parsedPayload);
                            }
                            break;
                        }
                        default: {
                            break;
                        }
                    }
                    break;
                }
                case 'set': {
                    switch (topicResource) {
                        case 'config': {
                            await this.setConfig(parsedMessage.Messages.map((dsm => {
                                return dsm.Payload
                            })), topicFilter, parsedMessage.MessageId);
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
                case 'pub': {
                    switch (topicResource) {
                        case 'mam': {
                            if (topicArr.length > 9) {
                                // TODO cfz: support for mam that contains all assets of an application?
                                this.addToRegistry(topic, parsedPayload);
                            }
                            break;
                        }
                        default: {
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

    /**
     * Update the containerstate with the configObject
     * @param configObject - the object that is to be passed to the ContainerState
     * //TODO: Careful! This is pretty hardcoded and unique for the Registry app.
     * A generic way was once in MessageBus Service component in commits from ~17.03.2021
     * @param configObjectArr - An array containing Registry-App specific configt objects
     * @param filter - The filter which was used to set the config
     */
    async setConfig(configObjectArr: ISpecificContainerConfig[], filter: string, correlationId: string) {
        let errorSoFar  = false;
        const tempConfig = JSON.parse(JSON.stringify(this.applicationResources.config));
        for (const configObjects of configObjectArr) {
            for (const configGroups of Object.keys(configObjects)) {
                if (configGroups === 'context') continue;
                for (const configItems of Object.keys(configObjects[configGroups])) {
                    // Safety-checks and overwrite of values
                    switch (configItems) {
                        case 'auditLevel': {
                            if (Object.values(ESyslogEventFilter).includes(configObjects['logging']['auditLevel'].value as ESyslogEventFilter)) { // Test if auditLevel is really part of the enum
                                tempConfig['logging']['auditLevel'].value = configObjects['logging']['auditLevel'].value;
                            } else {
                                this.logger.log(`Config setting ${configItems} failed due to safety check`, ESyslogEventFilter.warning);
                                errorSoFar = true;
                            }
                            break;
                        }
                        case 'logType': {
                            if (['enabled', 'disabled', 'endpoint'].includes(configObjects['logging']['logType'].value)) { // Test if logType is part of our "enum"
                                tempConfig['logging']['logType'].value = configObjects['logging']['logType'].value;
                            } else {
                                this.logger.log(`Config setting ${configItems} failed due to safety check`, ESyslogEventFilter.warning);
                                errorSoFar = true;
                            }
                            break;
                        }
                        case 'logFileSize': {
                            if (/^[-+]?(\d+|Infinity)$/.test(configObjects['logging']['logFileSize'].value)) { // Test if logFileSize is a "number"
                                tempConfig['logging']['logFileSize'].value = configObjects['logging']['logFileSize'].value;
                            } else {
                                this.logger.log(`Config setting ${configItems} failed due to safety check`, ESyslogEventFilter.warning);
                                errorSoFar = true;
                            }
                            break;
                        }
                        case 'developmentMode': {
                            if (configObjects['registry']['developmentMode'].value === 'false' || configObjects['registry']['developmentMode'].value === 'true') { // Test if devMode is a boolean
                                tempConfig['registry']['developmentMode'].value = configObjects['registry']['developmentMode'].value;
                            } else {
                                this.logger.log(`Config setting ${configItems} failed due to safety check`, ESyslogEventFilter.warning);
                                errorSoFar = true;
                            }
                            break;
                        }
                        case 'showRegistry': {
                            if (configObjects['registry']['showRegistry'].value === 'false' || configObjects['registry']['showRegistry'].value === 'true') { // Test if showReg is a boolean
                                tempConfig['registry']['showRegistry'].value = configObjects['registry']['showRegistry'].value;
                            } else {
                                this.logger.log(`Config setting ${configItems} failed due to safety check`, ESyslogEventFilter.warning);
                                errorSoFar = true;
                            }
                            break;
                        }
                        default: {
                            if (configItems === 'name' || configItems === 'description') break; // No need to warn, if we are at name and description
                            this.logger.log('Unknown config item...', ESyslogEventFilter.warning);
                            break;
                        }
                    }
                }
            }
        }
        let statusToPublish = 0;
        if (!errorSoFar) {
            this.applicationResources.config = tempConfig;
            this.logger.log('Updated config');
        } else {
            this.logger.log('One or more config items failed the safety check', ESyslogEventFilter.warning);
            statusToPublish = EOPCUAStatusCode.Bad;
        }
        const payload: IOPCUADataSetMessage[] = [];
        const actualPayload: ISpecificContainerConfig = this.applicationResources['config'] as ISpecificContainerConfig; // TODO cfz cast
        payload.push({
            filter: actualPayload.context.name.text.toLowerCase().replace(' ', ''),
            Payload: actualPayload,
            DataSetWriterId: CDataSetWriterIdLookup['config'],
            subResource: this.oi4Id,
            Status: statusToPublish,
        });

        const networkMessage = this.builder.buildOPCUANetworkMessage(payload, new Date(), DataSetClassIds[Resource.CONFIG], correlationId);
        await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/config/${this.oi4Id}/${filter}`, JSON.stringify(networkMessage));
    }

    /**
     * If we receive a pubMam Event from the MessageBusProxy, we check if that Mam is already in our Registry lookup
     * If not, we add it to the registry, if yes, we don't.
     * @param mqttObj The full mqtt message containing a potential addition to the registry
     */
    async addToRegistry(topic: string, parsedPayload: any): Promise<void> {
        const topicArr = topic.split('/');
        const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset
        if (this.getAsset(assetId)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
            this.logger.log('--MasterAssetModel already in Registry - addToRegistry--', ESyslogEventFilter.debug);
            if (this.assetLookup[assetId].available) {
                this.logger.log(`Device ${assetId} was available before, no need to re-add`, ESyslogEventFilter.warning);
                return;
            }
            this.logger.log(`Device ${assetId} was unavailable before and is now back! Re-Registering`, ESyslogEventFilter.warning);
        }

        try {
            this.logger.log('Enqueueing ADD-Device', ESyslogEventFilter.debug);
            this.queue.push(async () => {
                return await this.addDevice(topic, parsedPayload);
            });
        } catch (addErr) {
            this.logger.log(`Add-Error: ${addErr}`, ESyslogEventFilter.error);
        }
    }

    /**
     * Adds an asset based on the topic it registered on and its MasterAssetModel to the registry.
     * The asset is either classified into a device or an application
     * @param fullTopic The topic that contains information about the device being added
     * @param masterAssetModel The MasterAssetModel of the device
     */
    async addDevice(fullTopic: string, masterAssetModel: IMasterAssetModel): Promise<void> {
        this.logger.log(`----------- ADDING ASSET ----------:  ${fullTopic}`, ESyslogEventFilter.informational);
        const topicArr = fullTopic.split('/');
        const oi4IdOriginator = `${topicArr[2]}/${topicArr[3]}/${topicArr[4]}/${topicArr[5]}`; // This is the OI4-ID of the Orignator Container
        const oi4IdAsset = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset

        if (this.getAsset(oi4IdAsset)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
            this.logger.log('--MasterAssetModel already in Registry - addDevice--', ESyslogEventFilter.debug);
            if (this.assetLookup[oi4IdAsset].available) {
                this.logger.log(`Device ${oi4IdAsset} was available before, no need to re-add`, ESyslogEventFilter.warning);
                return;
            }
            this.logger.log(`Device ${oi4IdAsset} was unavailable before and is now back! Re-Registering`, ESyslogEventFilter.warning);
        }

        const assetType = this.getAssetType(masterAssetModel);
        const conf = await this.conformityValidator.checkConformity(assetType, `oi4/${topicArr[1]}/${oi4IdOriginator}`, oi4IdAsset);
        if (Object.keys(masterAssetModel).length === 0) {
            this.logger.log('Critical Error: MAM of device to be added is empty', ESyslogEventFilter.error);
            return;
        }
        const fullDevice: IAsset = {
            oi4IdOriginator,
            oi4Id: oi4IdAsset,
            eventList: [],
            lastMessage: '',
            registeredAt: '',
            resources: {
                mam: masterAssetModel,
            },
            topicPreamble: `oi4/${topicArr[1]}/${oi4IdOriginator}`,
            conformityObject: conf,
            available: true,
            assetType: assetType,
        };
        console.log(masterAssetModel);
        if (assetType === EAssetType.application) {
            this.logger.log('___Adding Application___', ESyslogEventFilter.debug);
        } else {
            this.logger.log('___Adding Device___', ESyslogEventFilter.debug);
        }

        this.assetLookup[oi4IdAsset] = fullDevice;

        // Subscribe to all changes regarding this application
        this.ownSubscribe(`${this.assetLookup[oi4IdAsset].topicPreamble}/pub/health/${oi4IdAsset}`);
        this.ownSubscribe(`${this.assetLookup[oi4IdAsset].topicPreamble}/pub/license/${oi4IdAsset}`);
        this.ownSubscribe(`${this.assetLookup[oi4IdAsset].topicPreamble}/pub/rtLicense/${oi4IdAsset}`);
        this.ownSubscribe(`${this.assetLookup[oi4IdAsset].topicPreamble}/pub/licenseText/#`);
        this.ownSubscribe(`${this.assetLookup[oi4IdAsset].topicPreamble}/pub/config/${oi4IdAsset}`);
        this.ownSubscribe(`${this.assetLookup[oi4IdAsset].topicPreamble}/pub/profile/${oi4IdAsset}`);
        // Try to get them at least once!
        try {
            await this.updateResourceInDevice(oi4IdAsset, Resource.HEALTH);
            await this.updateResourceInDevice(oi4IdAsset, Resource.PROFILE); // Initial profile reading
            await this.updateResourceInDevice(oi4IdAsset, Resource.SUBSCRIPTION_LIST); // TODO cfz: Why subscription list? This is not supported by many assets. 
            this.assetLookup[oi4IdAsset]['registeredAt'] = new Date().toISOString();
            this.assetLookup[oi4IdAsset]['lastMessage'] = new Date().toISOString();

            const licenseObj = this.assetLookup[oi4IdAsset].resources.license;
            if (licenseObj) {
                await this.getLicenseTextFromDevice(oi4IdAsset, Resource.LICENSE_TEXT, licenseObj.licenseId);
            }
        } catch (err) {
            console.log(err);
        }
        // Update own publicationList with new Asset
        const publicationList = new PublicationList();
        publicationList.resource = 'mam';
        publicationList.oi4Identifier = oi4IdAsset;
        publicationList.DataSetWriterId = 0;
        publicationList.config = PublicationListConfig.NONE_0;
        publicationList.interval = 0;
        publicationList.subResource = oi4IdAsset;

        this.applicationResources.addPublication(publicationList);
        // Publish the new publicationList according to spec
        await this.registryClient.publish(
            `oi4/Registry/${this.oi4Id}/pub/publicationList`,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                Payload: this.applicationResources.publicationList,
                DataSetWriterId: CDataSetWriterIdLookup['publicationList'],
                subResource: this.oi4Id
            }], new Date(), DataSetClassIds[Resource.PUBLICATION_LIST])),
        );
    }

    private getAssetType( masterAssetModel: IMasterAssetModel): EAssetType
    {
        // OEC development specification section 4 (mam) about the 'HardwareRevision':
        // An application (software only) might be listed as an asset and therefore also has a nameplate. 
        // In this case, the HardwareRevision shall be set to an empty string to detect the differences 
        // between hardware and software only assets!
        if (masterAssetModel.HardwareRevision === '') {
            return EAssetType.application;
        } 
          
        return  EAssetType.device;
     }

    /**
     * If we receive a getMam Event from the MessageBusProxy, we lookup the Mam in our Registry.
     * TODO: Currently, only an empty Tag is supported, which leads to a publish of ALL Mam Data on /pub/mam/<oi4Id>
     */
    async sendOutMam(filter: string, page: number, perPage: number) {
        const apps = this.applications as IAssetLookup;
        const devices = this.devices as IAssetLookup;
        const assets: IAssetLookup = Object.assign({}, apps, devices);
        if (filter === '') {
            this.logger.log(`Sending all known Mams...count: ${Object.keys(assets).length}`, ESyslogEventFilter.debug);
            let index: number = 0;
            const mamPayloadArr: IOPCUADataSetMessage[] = [];
            for (const device of Object.keys(assets)) {
                if (assets[device].available) {
                    let payload: IOPCUADataSetMessage = {
                        Payload: {},
                        DataSetWriterId: 0,
                        subResource: '',
                    };
                    try {
                        payload = {
                            subResource: assets[device].oi4Id,
                            Payload: assets[device].resources.mam,
                            DataSetWriterId: parseInt(`${CDataSetWriterIdLookup['mam']}${index}`, 10),
                        }
                    } catch {
                        this.logger.log('Error when trying to send a mam', ESyslogEventFilter.error);
                    }
                    mamPayloadArr.push(payload);
                    this.logger.log(`Built payload for device with OI4-ID ${assets[device].resources.mam.ProductInstanceUri}`);
                } else {
                    this.logger.log(`Not sending registered mam of ${assets[device].resources.mam.ProductInstanceUri} because it is not available`);
                }
                index++;
            }
            const paginatedMessageArray = this.builder.buildPaginatedOPCUANetworkMessageArray(mamPayloadArr, new Date(), DataSetClassIds[Resource.MAM], '', page, perPage);
            for (const networkMessage of paginatedMessageArray) {
                await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/mam`, JSON.stringify(networkMessage));
            }
        } else {

            // TODO cfz: Filtering of Mam really necessary? According the spec the mam do not make use of filter -->

            const dswidFilterStr = filter.substring(1);
            const dswidFilter = parseInt(dswidFilterStr, 10);
            if (Number.isNaN(dswidFilter)) { // NaN means it's a string-based filter, probably oi4Id
                try {
                    const mamPayloadArr: IOPCUADataSetMessage[] = [{
                        subResource: assets[filter].oi4Id,
                        Payload: assets[filter].resources.mam,
                        DataSetWriterId: parseInt(`${CDataSetWriterIdLookup['mam']}${Object.keys(assets).indexOf(assets[filter].oi4Id)}`, 10),
                    }]

                    const networkMessage = this.builder.buildOPCUANetworkMessage(mamPayloadArr, new Date(), DataSetClassIds[Resource.MAM]);
                    await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/mam/${assets[filter].oi4Id}`, JSON.stringify(networkMessage));
                } catch (ex) {
                    this.logger.log(`Error when trying to send a mam with oi4Id-based filter: ${ex}`, ESyslogEventFilter.error);
                }
            } else { // DSWID filter
                try {
                    const mamPayloadArr: IOPCUADataSetMessage[] = [{
                        subResource: assets[Object.keys(assets)[dswidFilter]].oi4Id,
                        Payload: assets[Object.keys(assets)[dswidFilter]].resources.mam,
                        DataSetWriterId: parseInt(`${CDataSetWriterIdLookup['mam']}${dswidFilter}`, 10),
                    }]

                    const networkMessage = this.builder.buildOPCUANetworkMessage(mamPayloadArr, new Date(), DataSetClassIds[Resource.MAM]);
                    await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/mam/${mamPayloadArr[0].subResource}`, JSON.stringify(networkMessage));
                } catch (ex) {
                    this.logger.log(`Error when trying to send a mam with dswid-based filter: ${ex}`, ESyslogEventFilter.error);
                }
            }

            // <-- TODO cfz
        }
    }

    /**
     * If we receive a getMam Event from the MessageBusProxy, we lookup the Mam in our Registry.
     * TODO: Currently, only an empty Tag is supported, which leads to a publish of ALL Mam Data on /pub/mam/<oi4Id>
     */
    async sendOutHealth(filter: string, page: number, perPage: number) {
        const apps = this.applications as IAssetLookup;
        const devices = this.devices as IAssetLookup;
        const assets: IAssetLookup = Object.assign({}, apps, devices);
        if (filter === '') {
            this.logger.log(`Sending all known Healths...count: ${Object.keys(assets).length}`, ESyslogEventFilter.debug);
            let index = 0;
            const healthPayloadArr: IOPCUADataSetMessage[] = [];
            for (const device of Object.keys(assets)) {
                if (assets[device].available) {
                    let payload: IOPCUADataSetMessage = {
                        Payload: {},
                        DataSetWriterId: 0,
                        subResource: ''
                    };
                    try {
                        payload = {
                            subResource: assets[device].oi4Id,
                            Payload: assets[device].resources.health,
                            DataSetWriterId: parseInt(`${CDataSetWriterIdLookup['health']}${index}`, 10),
                        }
                    } catch {
                        this.logger.log('Error when trying to send health', ESyslogEventFilter.error);
                    }
                    healthPayloadArr.push(payload);
                    this.logger.log(`Built payload for device with OI4-ID ${assets[device].resources.mam.ProductInstanceUri}`);
                } else {
                    this.logger.log(`Not sending registered health of ${assets[device].resources.mam.ProductInstanceUri} because it is not available`);
                }
                index++;
            }
            const paginatedMessageArray = this.builder.buildPaginatedOPCUANetworkMessageArray(healthPayloadArr, new Date(), DataSetClassIds[Resource.HEALTH], '', page, perPage);
            for (const networkMessage of paginatedMessageArray) {
                await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/health`, JSON.stringify(networkMessage));
            }
        } else {
            {
                // TODO cfz: Remove filter logic -->

                const dswidFilterStr = filter.substring(1);
                const dswidFilter = parseInt(dswidFilterStr, 10);
                if (Number.isNaN(dswidFilter)) { // NaN means it's a string-based filter, probably oi4Id
                    try {
                        const healthPayloadArr: IOPCUADataSetMessage[] = [{
                            subResource: assets[filter].oi4Id,
                            Payload: assets[filter].resources.health,
                            DataSetWriterId: parseInt(`${CDataSetWriterIdLookup['health']}${Object.keys(assets).indexOf(assets[filter].oi4Id)}`, 10),
                        }]

                        const networkMessage = this.builder.buildOPCUANetworkMessage(healthPayloadArr, new Date(), DataSetClassIds[Resource.HEALTH])
                        await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/health/${assets[filter].oi4Id}`, JSON.stringify(networkMessage));
                    } catch (ex) {
                        this.logger.log(`Error when trying to send health with topic-based filter: ${ex}`, ESyslogEventFilter.error);
                    }
                } else { // DSWID filter
                    try {
                        const healthPayloadArr: IOPCUADataSetMessage[] = [{
                            subResource: assets[Object.keys(assets)[dswidFilter]].oi4Id,
                            Payload: assets[Object.keys(assets)[dswidFilter]].resources.health,
                            DataSetWriterId: parseInt(`${CDataSetWriterIdLookup['health']}${dswidFilter}`, 10),
                        }]

                        const networkMessage = this.builder.buildOPCUANetworkMessage(healthPayloadArr, new Date(), DataSetClassIds[Resource.HEALTH]);
                        await this.registryClient.publish(`oi4/Registry/${this.oi4Id}/pub/health/${healthPayloadArr[0].subResource}`, JSON.stringify(networkMessage));
                    } catch (ex) {
                        this.logger.log(`Error when trying to send a health with dswid-based filter: ${ex}`, ESyslogEventFilter.error);
                    }
                }

                // <-- TODO cfz
            }
        }
    }

    private removePublicationBySubResource(subResource: string): void
    {
        // TODO cfz find a better way to remove the publication list 
        
        for (let i=0; i < this.applicationResources.subscriptionList.length; i++)
        {
            if (this.applicationResources.publicationList[i].subResource == subResource)
            {
                this.applicationResources.publicationList.splice(i--, 1)
            }
        }
    }


    /**
     * Removes an asset from the assetLookup
     * @param device - the oi4Id of the device that is to be removed
     */
    removeDevice(device: string) {
        if (device in this.assetLookup) {
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/event/+/${device}`);
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/health/${device}`);
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/license/${device}`);
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/rtLicense/${device}`);
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/licenseText/#`);
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/config/${device}`);
            this.ownUnsubscribe(`${this.assetLookup[device].topicPreamble}/pub/profile/${device}`);
            delete this.assetLookup[device];
            // Remove from publicationList
            this.removePublicationBySubResource(device);
            // Publish the new publicationList according to spec
            this.registryClient.publish(
                `oi4/Registry/${this.oi4Id}/pub/publicationList`,
                JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                    Payload: this.applicationResources.publicationList,
                    DataSetWriterId: CDataSetWriterIdLookup['publicationList'],
                    subResource: this.oi4Id,
                }], new Date(), DataSetClassIds[Resource.PUBLICATION_LIST])),
            );
            this.logger.log(`Deleted App: ${device}`, ESyslogEventFilter.warning);
        } else {
            this.logger.log('Nothing to remove here!', ESyslogEventFilter.debug);
        }
    }

    /**
     * Clears the entire Registry by removing every asset from the assetLookup
     */
    clearRegistry() {
        for (const assets of Object.keys(this.assetLookup)) { // Unsubscribe topics of every asset
            this.ownUnsubscribe(`${this.assetLookup[assets].topicPreamble}/pub/health/${assets}`);
            this.ownUnsubscribe(`${this.assetLookup[assets].topicPreamble}/pub/license/${assets}`);
            this.ownUnsubscribe(`${this.assetLookup[assets].topicPreamble}/pub/rtLicense/${assets}`);
            this.ownUnsubscribe(`${this.assetLookup[assets].topicPreamble}/pub/licenseText/#`);
            this.ownUnsubscribe(`${this.assetLookup[assets].topicPreamble}/pub/config/${assets}`);
            this.ownUnsubscribe(`${this.assetLookup[assets].topicPreamble}/pub/profile/${assets}`);
            // Remove from publicationList
            this.removePublicationBySubResource(assets);
        }
        // Publish the new publicationList according to spec
        this.registryClient.publish(
            `oi4/Registry/${this.oi4Id}/pub/publicationList`,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                Payload: this.applicationResources.publicationList,
                DataSetWriterId: CDataSetWriterIdLookup['publicationList'],
                subResource: this.oi4Id
            }], new Date(), DataSetClassIds[Resource.PUBLICATION_LIST])),
        );
        this.assetLookup = {}; // Clear application lookup
    }

    /**
     * Runs a conformity check on an asset by utilizing the ConformityValidator and returns the conformity Object.
     * @param oi4Id The oi4Id of the asset that is to be checked for conformity
     * @param resourceList The resourceList that is to be checked for conformity
     */
    async updateConformityInDevice(oi4Id: string, resourceList: Resource[]): Promise<IConformity> {
        this.logger.log(`Checking conformity for ${oi4Id}`);
        let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
        if (oi4Id in this.assetLookup) {
            conformityObject = await this.conformityValidator.checkConformity(this.assetLookup[oi4Id].assetType, this.assetLookup[oi4Id].topicPreamble, this.assetLookup[oi4Id].oi4Id, resourceList);
            this.assetLookup[oi4Id].conformityObject = conformityObject;
        }
        return conformityObject;
    }

    /**
     * Updates the resource of a registered asset by publishing a /get/ request on the corresponding oi4-topic
     * @param oi4Id The oi4Id of the asset that is to be updated
     * @param resource The resource that is to be updated
     */
    async updateResourceInDevice(oi4Id: string, resource: Resource): Promise<void> {
        if (oi4Id in this.assetLookup) {
            const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[resource])
            await this.registryClient.publish(`${this.assetLookup[oi4Id].topicPreamble}/get/${resource}/${oi4Id}`, JSON.stringify(networkMessage));
            this.logger.log(`Sent Get ${resource} on ${this.assetLookup[oi4Id].topicPreamble}/get/${resource}/${oi4Id}`);
        }
    }

    /**
     * Updates the resource of a registered asset by publishing a /get/ request on the corresponding oi4-topic
     * @param oi4Id The oi4Id of the asset that is to be updated
     * @param resource The resource that is to be updated
     */
    async resourceTimeout(oi4Id: string, resource: Resource): Promise<void> {
        if (oi4Id in this.assetLookup) {
            if (!this.assetLookup[oi4Id].available) {
                if (typeof this.assetLookup[oi4Id].resources.health !== 'undefined') {
                    this.assetLookup[oi4Id].resources.health = new Health(EDeviceHealth.FAILURE_1, 0);
                }
                this.logger.log(`Timeout2 - Setting deviceHealth of ${oi4Id} to FAILURE_1 and healthState 0`, ESyslogEventFilter.warning);
                return;
            }
            const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[resource]);
            await this.registryClient.publish(`${this.assetLookup[oi4Id].topicPreamble}/get/${resource}/${oi4Id}`, JSON.stringify(networkMessage));
            this.secondStageTimeoutLookup[oi4Id] = <any>setTimeout(() => this.resourceTimeout(oi4Id, Resource.HEALTH), 65000); // Set new timeout, if we don't receive a health back...
            this.logger.log(`Timeout1 - Get ${resource} on ${this.assetLookup[oi4Id].topicPreamble}/get/${resource}/${oi4Id}, setting new timeout...`, ESyslogEventFilter.warning);
            this.assetLookup[oi4Id].available = false;
        }
    }

    /**
     * Updates the licenseText of a registered asset by publishing a /get/ request on the corresponding oi4-topic
     * @param oi4Id The oi4Id of the asset that is to be updated
     * @param resource The resource that is to be updated (in this case..licenseText)
     * @param license The license that is to be updated
     * TODO: merge this functionality into updateResourceInDevice by utilizing a default empty string parameter...
     */
    async getLicenseTextFromDevice(oi4Id: string, resource: Resource, license: string): Promise<void> {
        if (oi4Id in this.assetLookup) {
            const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[resource]);
            await this.registryClient.publish(`${this.assetLookup[oi4Id].topicPreamble}/get/${resource}/${license}`, JSON.stringify(networkMessage));
            this.logger.log(`Sent Get ${resource} on ${this.assetLookup[oi4Id].topicPreamble}/get/${resource}/${license}`);
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
        const oi4ToObjectList: IAsset[] = [];
        if (oi4Id in this.assetLookup) {
            oi4ToObjectList.push(this.assetLookup[oi4Id]);
            if (resource === 'lastMessage' || resource === 'eventList') {
                if (resource in this.assetLookup[oi4Id]) {
                    return this.assetLookup[oi4Id][resource];
                }
            }
            if ('resources' in this.assetLookup[oi4Id]) {
                if (resource in this.assetLookup[oi4Id].resources) {
                    return this.assetLookup[oi4Id].resources[resource];
                }
            }
        }
        return {
            err: 'Could not get resource from registry',
            foundObjects: oi4ToObjectList,
        };

    }

    /**
     * Retrieve and return the audit-trail per device (TODO: this function is unused currently)
     * @param oi4Id - The oi4id of the device
     */
    getEventTrailFromDevice(oi4Id: string) {
        if (oi4Id in this.assetLookup) {
            return this.assetLookup[oi4Id].eventList;
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
        if (!Object.values(ESyslogEventFilter).includes(this.getConfig().logging.auditLevel.value as ESyslogEventFilter)) {
            console.log('AuditLevel is not known to Registry');
            return;
        }
        // First, clear all old eventLists
        this.globalEventList = [];
        for (const apps of Object.keys(this.assetLookup)) {
            this.assetLookup[apps].eventList = [];
        }
        // Then, unsubscribe from old Audit Trail
        for (const levels of Object.values(ESyslogEventFilter)) {
            console.log(`Unsubscribed syslog trail from ${levels}`);
            await this.ownUnsubscribe(`oi4/+/+/+/+/+/pub/event/syslog/${levels}/#`);
        }
        // Then, resubscribe to new Audit Trail
        for (const levels of Object.values(ESyslogEventFilter)) {
            console.log(`Resubbed to syslog category - ${levels}`);
            await this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/syslog/${levels}/#`);
            if (levels === this.getConfig().logging.auditLevel.value) {
                return; // We matched our configured auditLevel, returning to not sub to redundant info...
            }
        }

        this.logger.level = this.getConfig().logging.auditLevel.value as ESyslogEventFilter;
    }

    /**
     * Wrapper for the deleteFiles method of the FileLogger.
     * Should be called whenever the logfileSize is changed
     */
    deleteFiles() {
        return this.fileLogger.deleteFiles();
    }

    /**
     * Updates the config of the Registry
     * @param newConfig the new config object
     */
    async updateConfig(newConfig: ISpecificContainerConfig) {
        this.applicationResources.config = newConfig;
        this.logger.log(`Sanity-Check: New config as json: ${JSON.stringify(this.applicationResources.config)}`, ESyslogEventFilter.debug);
    }

    /**
     * Retrieves the config of the Registry
     * @returns The config of the registry
     */
    getConfig(): ISpecificContainerConfig {
        return this.applicationResources.config as ISpecificContainerConfig; // TODO cfz ensure that always the specific container config is loaded
    }

    /**
     * Getter for applicationLookup
     * @returns {IDeviceLookup} The applicationLookup of the Registry
     */
    get applications() {
        return Object.keys(this.assetLookup)
            .filter((key) => {
                if (this.assetLookup[key].assetType === EAssetType.application) return true;
                return false;
            })
            .reduce(
                (obj: any, key) => {
                    obj[key] = this.assetLookup[key];
                    return obj;
                },
                {});
    }

    /**
     * Getter for deviceLookup
     * @returns {IDeviceLookup} The deviceLookup of the Registry
     */
    get devices() {
        return Object.keys(this.assetLookup)
            .filter((key) => {
                if (this.assetLookup[key].assetType === EAssetType.device) return true;
                return false;
            })
            .reduce(
                (obj: any, key) => {
                    obj[key] = this.assetLookup[key];
                    return obj;
                },
                {});
    }

    /**
     * Gets the global event list. 
     * @returns The global event list.
     */
    get eventTrail() : IEventObject[] {
        return this.globalEventList;
    }

    /**
     * Retrieve the global event list up to a specified amount of elements.
     * @param noOfElements - The amount of elements that is to be retrieved
     * @returns The global event list up to the specified amout of elements 
     */
    public getEventTrail(noOfElements: number) : IEventObject[] {
        if (this.globalEventList.length <= noOfElements) {
            return this.globalEventList;
        } // else
        return this.globalEventList.slice(this.globalEventList.length - noOfElements, this.globalEventList.length);
    }

    /**
     * Retrieves a single asset by its oi4Id
     * @param oi4Id The oi4Id of the asset that is to be retrieved
     * @returns The asset
     */
    getAsset(oi4Id: string): IAsset | undefined {
        if (oi4Id in this.assetLookup) {
            return this.assetLookup[oi4Id];
        }
    }

    /**
     * Retrieves the oi4Id of the registry
     */
    getOi4Id(): string {
        return this.oi4Id;
    }
}