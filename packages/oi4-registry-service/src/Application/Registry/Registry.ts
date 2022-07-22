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
    Health,
    PublicationList,
    SubscriptionList,
    Resource,
    EAssetType,
    DataSetClassIds,
    IContainerConfig,
    DataSetWriterIdManager,
    License,
    RTLicense,
    LicenseText,
    Profile,
    MasterAssetModel
} from '@oi4/oi4-oec-service-model';
import {
    EOPCUAStatusCode,
    IOPCUANetworkMessage,
    IOPCUADataSetMessage,
    OPCUABuilder    
} from '@oi4/oi4-oec-service-opcua-model';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {FileLogger, TopicParser, TopicMethods} from '@oi4/oi4-oec-service-node';
import {ConformityValidator, EValidity, IConformity} from '@oi4/oi4-oec-service-conformity-validator';
import {IAssetLookup, IAsset, IReceivedEvent, IResourceObject} from '../Models/IRegistry';
import { ELogType, ISettings } from '../Models/ISettings';
import { RegistryResources } from '../RegistryResources';
import { TopicInfo } from '@oi4/oi4-oec-service-node/dist/Utilities/Helpers/Types';


export class Registry extends EventEmitter {
    private assetLookup: IAssetLookup;
    private client: mqtt.AsyncClient;
    private globalEventList: IReceivedEvent[];
    private builder: OPCUABuilder;
    private logger: Logger;
    private readonly oi4DeviceWildCard: string;
    private readonly oi4Id: string;
    private queue: SequentialTaskQueue;
    private logToFileEnabled: ELogType;
    private logHappened: boolean;
    private readonly applicationResources: RegistryResources;
    private readonly maxAuditTrailElements: number;
    private fileLogger: FileLogger;

    private flushTimeout: any;

    // Timeout container TODO: types
    private readonly timeoutLookup: any;
    private conformityValidator: ConformityValidator;

    /**
     * The constructor of the Registry
     * @param client The global mqtt client used to avoid multiple client connections inside the container
     * @param appResources The containerState of the OI4-Service holding information about the oi4Id etc.
     */
    constructor(client: mqtt.AsyncClient, appResources: RegistryResources) {
        super();
        this.oi4Id = appResources.oi4Id;
        this.logToFileEnabled = appResources.settings.logging.logType;
        // Config section
        appResources.on('settingsChanged', (oldSettings: ISettings, newSettings: ISettings) => {
            if (oldSettings.logging.logType === ELogType.enabled) {
                this.flushTimeout = setTimeout(() => this.flushToLogfile(), 60000);
            }
            if (oldSettings.logging.auditLevel !== newSettings.logging.auditLevel) {
                this.logger.log(`auditLevel is different, updating from ${oldSettings.logging.auditLevel} to ${newSettings.logging.auditLevel}`, ESyslogEventFilter.debug);
                this.updateAuditLevel();
            }
            if (oldSettings.logging.logFileSize !== newSettings.logging.logFileSize) { // fileSize changed!
                this.logToFileEnabled = ELogType.disabled; // Temporarily disable logging
                this.logger.log(`fileSize for File-logging changed! (old: ${oldSettings.logging.logFileSize}, new: ${newSettings.logging.logFileSize}) Deleting all old files and adjusting file`);
                this.deleteFiles();
                this.logToFileEnabled = newSettings.logging.logType;
            }
        });

        const logLevel: ESyslogEventFilter = process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning;
        const publishingLevel = process.env.OI4_EDGE_EVENT_PUBLISHING_LEVEL ? process.env.OI4_EDGE_EVENT_PUBLISHING_LEVEL as ESyslogEventFilter : logLevel;
        
        this.logger = new Logger(true, 'Registry-App', logLevel, publishingLevel, client, this.oi4Id, 'Registry');
        this.fileLogger = new FileLogger(appResources.settings.logging.logFileSize);

        this.queue = new SequentialTaskQueue();
        this.applicationResources = appResources;

        this.timeoutLookup = {};
        this.oi4DeviceWildCard = 'oi4/+/+/+/+/+';
        this.globalEventList = [];
        this.assetLookup = {};
        this.maxAuditTrailElements = 100;
        this.logHappened = false;

        this.builder = new OPCUABuilder(this.oi4Id, appResources.mam.getServiceType());
        this.conformityValidator = new ConformityValidator(this.oi4Id, client);
        this.client = client;

        this.client.on('connect', async () => this.onClientConnect());

        // setInterval(() => { this.flushToLogfile; }, 60000); // TODO: Re-enable
    }

    private async onClientConnect(): Promise<void> {
        await this.initSubscriptions();
        this.client.on('message', this.processMqttMessage);

        // In most cases the mam for the registry was already published via the OI4 service node component
        // --> We publish the mam again so that the registry detects 'itself' and to enforce validation of the registry
        // TODO: Instead publishing of the mam again we could also call addToRegistry for ourself
        const mam = this.applicationResources.mam;
        await this.client.publish(`oi4/${mam.getServiceType()}/${this.oi4Id}/pub/mam/${this.oi4Id}`,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                subResource: this.oi4Id,
                Payload: this.applicationResources.mam,
                DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(Resource.MAM, this.oi4Id),
            }], new Date(), DataSetClassIds.mam)),
        );
    }

    private async initSubscriptions(): Promise<void> {
        // Subscribe to generic events
        for (const levels of Object.values(EGenericEventFilter)) {
            console.log(`Subbed initially to generic category - ${levels}`);
            await this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/generic/${levels}/#`);
        }
        // Subscribe to namur events
        for (const levels of Object.values(ENamurEventFilter)) {
            console.log(`Subbed initially to namur category - ${levels}`);
            await this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/ne107/${levels}/#`);
        }
        // Subscribe to syslog events
        for (const levels of Object.values(ESyslogEventFilter)) {
            console.log(`Subbed initially to syslog category - ${levels}`);
            await this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/syslog/${levels}/#`);
        }
        // Subscribe to OPCUA events
        for (const levels of Object.values(EOpcUaEventFilter)) {
            console.log(`Subbed initially to syslog category - ${levels}`);
            await this.ownSubscribe(`oi4/+/+/+/+/+/pub/event/opcSC/${levels}/#`);
        }

        await this.ownSubscribe(`${this.oi4DeviceWildCard}/set/mam/#`); // Explicit "set"
        await this.ownSubscribe(`${this.oi4DeviceWildCard}/pub/mam/#`); // Add Asset to Registry
        await this.ownSubscribe(`${this.oi4DeviceWildCard}/del/mam/#`); // Delete Asset from Registry
        await this.ownSubscribe(`${this.oi4DeviceWildCard}/pub/health/#`); // Add Asset to Registry
        await this.ownSubscribe('oi4/Registry/+/+/+/+/get/mam/#');
    }

    /**
     * Overrides the default mqtt-subscription in order to automatically adjust the 'subscriptionList' resource
     * @param topic - The topic that should be subscribed to
     */
    private async ownSubscribe(topic: string): Promise<mqtt.ISubscriptionGrant[]> {

        const subscription = new SubscriptionList();
        subscription.topicPath = topic;
        subscription.config = SubscriptionListConfig.NONE_0;
        subscription.interval = 0;

        this.applicationResources.addSubscription(subscription);
        return await this.client.subscribe(topic);
    }

    /**
     * Overrides the default mqtt-unsubscription in order to automatically adjust the 'subscriptionList' resource
     * @param topic - The topic that should be unsubscribed from
     */
    private async ownUnsubscribe(topic: string): Promise<void> {
        // Remove from subscriptionList
        this.removeSubscriptionByTopic(topic);
        await this.client.unsubscribe(topic);
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
    private processMqttMessage = async (topic: string, message: Buffer): Promise<void> => {
        let topicInfo: TopicInfo;
        try {
            const topicWrapper = TopicParser.getTopicWrapperWithCommonInfo(topic);
            topicInfo = TopicParser.extractResourceSpecificInfo(topicWrapper);
        } catch (e) {
            this.logger.log(`Error when parsing the topic ${topic}`, ESyslogEventFilter.warning);
            return;
        }
        
        let networkMessage: IOPCUANetworkMessage;
        try {
            networkMessage = JSON.parse(message.toString());
        } catch (e) {
            this.logger.log(`Error when parsing JSON in processMqttMessage: ${e}`, ESyslogEventFilter.warning);
            this.logger.log(`Topic: ${topic}`, ESyslogEventFilter.warning);
            this.logger.log(message.toString(), ESyslogEventFilter.warning);
            return;
        }
        let schemaResult = false;
        try {
            schemaResult = await this.builder.checkOPCUAJSONValidity(networkMessage);
        } catch (e) {
            if (typeof e === 'string') {
                this.logger.log(e, ESyslogEventFilter.warning);
            }
        }
        if (!schemaResult) {
            this.logger.log('Error in pre-check (crash-safety) schema validation, please run asset through conformity validation or increase logLevel', ESyslogEventFilter.warning);
            return;
        }

        let parsedPayload: any = {}; // FIXME: Hotfix, remove the "any" and see where it goes...
        if (networkMessage.Messages.length !== 0) {
            parsedPayload = networkMessage.Messages[0].Payload;
        }

         // Safety-Check: DataSetClassId
        if (networkMessage.DataSetClassId !== DataSetClassIds[topicInfo.resource]) {
            this.logger.log(`Error in pre-check, dataSetClassId mismatch, got ${networkMessage.DataSetClassId}, expected ${DataSetClassIds[topicInfo.resource]}`, ESyslogEventFilter.warning);
            return;
        }

        if (topicInfo.oi4Id in this.assetLookup) { // If we've got this oi4Id in our lookup, we update its "life-sign", even if the payload might be wrong later on
            this.assetLookup[topicInfo.oi4Id].lastMessage = new Date().toISOString();
        }

        switch (topicInfo.method) {
            case TopicMethods.PUB:
                await this.executePubActions(topicInfo, networkMessage);
                break;
        }

        if (topicInfo.appId === this.oi4Id) {
            switch (topicInfo.method) {
                case TopicMethods.GET: {

                    /* TODO cfz -->
                    let payloadType = 'empty';
                    let page = 0;
                    let perPage = 0;

                    if (networkMessage.Messages.length !== 0) {
                        for (const messages of networkMessage.Messages) {
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
                    <-- */

                    switch (topicInfo.resource) {
                        case Resource.MAM: {
                            this.logger.log('Someone requested a mam with our oi4Id as appId', ESyslogEventFilter.debug);
                            // if (topicFilter.includes('Registry')) break; // TODO cfz This request should be handled in the service component
                            // this.sendOutMam(topicFilter, page, perPage);
                            break;
                        }
                        case Resource.HEALTH: {
                            this.logger.log('Someone requested a health with our oi4Id as appId', ESyslogEventFilter.debug);
                            // if (topicFilter.includes('Registry')) break; // TODO cfz This request should be handled in the service component
                            // this.sendOutHealth(topicFilter, page, perPage);
                        }
                        default: {
                            break;
                        }
                    }
                    break;
                }
                case TopicMethods.SET: {
                    switch (topicInfo.resource) {
                        case 'config': {
                            // TODO cfz set subResource and filter
                            await this.getConfig(networkMessage, this.oi4Id);
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

    private async executePubActions(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {
        if (topicInfo.method !== TopicMethods.PUB) {
            throw new Error('Invalid argument topicInfo. Method must be TopicMethods.PUB.')
        }

        if (networkMessage.Messages.length === 0) { // In pub, we do not expect empty messages, they always need at least one entry
            this.logger.log('Messages Array empty in pub - check DataSetMessage format', ESyslogEventFilter.warning);
            return;
        }

        switch (topicInfo.resource)
        {
            case Resource.MAM:
                await this.addToRegistry(topicInfo, networkMessage);
                break;
            case Resource.EVENT:
                await this.processPublishedEvent(topicInfo, networkMessage);
                break;
            case Resource.HEALTH:
                await this.processPublishedHealth(topicInfo, networkMessage);
                break;
            case Resource.LICENSE:
                this.getMessages(networkMessage, (m) => this.updateResource(m, (r) => r.License = License.clone(m.Payload)));
                break;
            case Resource.RT_LICENSE:
                this.getMessages(networkMessage, (m) => this.updateResource(m, (r) => { 
                    const rtLicense = new RTLicense();
                    Object.assign(rtLicense, m.Payload); 
                    r.rtLicense = rtLicense;}));
                break;
            case Resource.LICENSE_TEXT:
                this.getMessages(networkMessage, (m) => this.updateResource(m, (r) => r.licenseText = LicenseText.clone(m.Payload)));
                break;

            case Resource.CONFIG:
                this.getMessages(networkMessage, (m) => this.updateResource(m, (r) => r.config = JSON.parse(JSON.stringify(m.Payload))));
                break;

            case Resource.PROFILE:
                this.getMessages(networkMessage, (m) => this.updateResource(m, (r) => r.profile = Profile.clone(m.Payload)));
                break;
        }
    }

    private async getMessages(networkMessage: IOPCUANetworkMessage, proc: (m: IOPCUADataSetMessage) => void): Promise<void> {
        for (const dataSetMessage of networkMessage.Messages) {

            if (typeof dataSetMessage.Payload.page !=='undefined') { // found pagination 
                // TODO: request next messages?
                continue;
            }

            proc(dataSetMessage);
        }
    }

    private updateResource(dataSetMessage: IOPCUADataSetMessage, update: (asset: IResourceObject) => void): void {
        if (dataSetMessage.subResource in this.assetLookup) {
            update(this.assetLookup[dataSetMessage.subResource].resources)
        }
    }

    private async processPublishedEvent(_topicInfo: TopicInfo, _networkMessage: IOPCUANetworkMessage): Promise<void>
    {
        this.logHappened = true; // We got some form of logs

        if (this.globalEventList.length >= this.maxAuditTrailElements) {
                // If we have too many elements in the list, we purge them
                clearTimeout(this.flushTimeout);
                this.flushToLogfile(); // This will also shift the array if there are too many entries!
        }

        /* TODO cfz
        const parsedPayload = networkMessage.Messages[0].Payload;

        this.globalEventList.push({ // So we have space for this payload!
                ...parsedPayload,
                level: topicFilter.split('/')[1],
                timestamp: networkMessage.Messages[0].Timestamp,
                tag: topicAppId,
            });
        */ 
    }

    private async processPublishedHealth(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {

        this.getMessages(networkMessage, async (m) => {
            const oi4Id = m.subResource;
            this.logger.log(`Got Health from ${oi4Id}.`);

            const health = Health.clone(m.Payload);

            if (oi4Id in this.assetLookup) {
                this.logger.log(`Resetting timeout from health for oi4Id: ${oi4Id}`, ESyslogEventFilter.warning);
                // This timeout will be called regardless of enable-setting. Every 60 seconds we need to manually poll health
                clearTimeout(this.timeoutLookup[oi4Id]);
    
                if (health.health === EDeviceHealth.FAILURE_1 && health.healthScore === 0) {
                    this.logger.log(`Kill-Message detected in Asset: ${oi4Id}, setting availability to false.`, ESyslogEventFilter.warning);
                    await this.removeDevice(oi4Id);
                } else {
                    const timeout = <any>setTimeout(() => this.resourceTimeout(oi4Id), 65000);
                    this.timeoutLookup[oi4Id] = timeout;

                    this.assetLookup[oi4Id].lastMessage = new Date().toISOString();
                    this.assetLookup[oi4Id].resources.health = health;
                }

            this.logger.log(`Setting health of ${oi4Id} to: ${JSON.stringify(health)}`);
            } else {
                if (topicInfo.appId  === this.oi4Id) return;
    
                const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[Resource.MAM]);
                const topic = `oi4/${topicInfo.serviceType}/${topicInfo.appId}/get/mam/${topicInfo.appId}`;
                await this.client.publish(topic, JSON.stringify(networkMessage));
                this.logger.log(`Got a health from unknown Asset, requesting mam on ${topic}`, ESyslogEventFilter.debug);
            }
        });
    }

    /**
     * Update the containerstate with the configObject
     * @param getConfigMessage - The network message that requests the config.
     * @param subResource - The subResource for which the configuration is requested.
     * @param filter - The filter which was used to set the config
     */
    // TODO Remove this method as soon as getConfig is supported by the OI4 service 
    async getConfig(getConfigMessage: IOPCUANetworkMessage, subResource?: string,  filter?: string): Promise<void> {
        if (subResource !== undefined && subResource!=this.oi4Id)
        {
            this.logger.log(`Configuration was requested for unknown subResource: ${subResource}.`, ESyslogEventFilter.warning);
            return;
        }

        const payload: IOPCUADataSetMessage[] = [];
        if (this.applicationResources.config !== undefined) {
            payload.push({
                filter: this.applicationResources.config.context.name.text.toLowerCase().replace(' ', ''),
                Payload: this.applicationResources.config,
                DataSetWriterId: CDataSetWriterIdLookup['config'],
                subResource: subResource,
                Status: EOPCUAStatusCode.Good,
            });
        }

        const correlationId = getConfigMessage.MessageId;

        const networkMessage = this.builder.buildOPCUANetworkMessage(payload, new Date(), DataSetClassIds[Resource.CONFIG], correlationId);
        let topic = `oi4/Registry/${this.oi4Id}/pub/config`;
        if (subResource !== undefined)
        {
            topic = `oi4/Registry/${this.oi4Id}/pub/config/${subResource}`
        }
        if (subResource !== undefined && filter !== undefined)
        {
            topic = `oi4/Registry/${this.oi4Id}/pub/config/${this.oi4Id}/${filter}`;
        }

        await this.client.publish(topic, JSON.stringify(networkMessage));
    }

    /**
     * If we receive a pubMam Event from the MessageBusProxy, we check if that Mam is already in our Registry lookup
     * If not, we add it to the registry, if yes, we don't.
     */
    async addToRegistry(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {

        await this.getMessages(networkMessage, async (m) => {
            const assetId = m.subResource;

            if  (this.getAsset(assetId)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
                this.logger.log('--MasterAssetModel already in Registry - addToRegistry--', ESyslogEventFilter.debug);
                return;
            }
            try {
                const mam = MasterAssetModel.clone(m.Payload);
                this.logger.log('Enqueueing ADD-Device', ESyslogEventFilter.debug);
                this.queue.push(async () => {
                    return await this.addAsset(topicInfo, mam);
                });
            } catch (addErr) {
                this.logger.log(`Add-Error: ${addErr}`, ESyslogEventFilter.error);
            }
        });
    }

    /**
     * Adds an asset based on the topic it registered on and its MasterAssetModel to the registry.
     * The asset is either classified into a device or an application
     * @param fullTopic The topic that contains information about the device being added
     * @param masterAssetModel The MasterAssetModel of the device
     */
    async addAsset(topicInfo: TopicInfo, masterAssetModel: MasterAssetModel): Promise<void> {
        this.logger.log(`----------- ADDING ASSET ----------:  ${topicInfo.topic}`, ESyslogEventFilter.informational);
        
        if (Object.keys(masterAssetModel).length === 0) {
            this.logger.log('Critical Error: MAM of device to be added is empty', ESyslogEventFilter.error);
            return;
        }
        const oi4Id = topicInfo.oi4Id !== undefined ? topicInfo.oi4Id : topicInfo.appId;

        if (this.getAsset(oi4Id)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
            this.logger.log('--MasterAssetModel already in Registry - addDevice--', ESyslogEventFilter.debug);
            return;
        }

        const assetType = this.getAssetType(masterAssetModel);
        const registeredAt = new Date().toISOString();
        const newAsset: IAsset = {
            oi4IdOriginator: topicInfo.appId,
            oi4Id: oi4Id,
            eventList: [],
            lastMessage: registeredAt,
            registeredAt: registeredAt,
            resources: {
                mam: masterAssetModel,
            },
            topicPreamble: `oi4/${topicInfo.serviceType}/${topicInfo.appId}`,
            conformityObject: { 
                oi4Id: EValidity.default,
                validity: EValidity.default,
                checkedResourceList: [],
                profileResourceList: [],
                nonProfileResourceList: [],
                resource:{}
            },
            assetType: assetType,
        };
        console.log(masterAssetModel);
        if (assetType === EAssetType.application) {
            this.logger.log('___Adding Application___', ESyslogEventFilter.debug);
        } else {
            this.logger.log('___Adding Device___', ESyslogEventFilter.debug);
        }

        this.assetLookup[oi4Id] = newAsset;


        // Subscribe to all changes regarding this application 
        // TODO cfz  really necessary? In this case add the missing resources
        this.ownSubscribe(`${newAsset.topicPreamble}/pub/health/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/pub/license/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/pub/rtLicense/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/pub/licenseText/#`);
        this.ownSubscribe(`${newAsset.topicPreamble}/pub/config/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/pub/profile/${oi4Id}`);
        
        newAsset.conformityObject = await this.conformityValidator.checkConformity(assetType, newAsset.topicPreamble, oi4Id);

        // Update own publicationList with new Asset
        const publicationList = new PublicationList();
        publicationList.resource = Resource.MAM;
        publicationList.oi4Identifier = topicInfo.appId;
        publicationList.DataSetWriterId = 0;
        publicationList.config = PublicationListConfig.NONE_0;
        publicationList.interval = 0;
        publicationList.subResource = oi4Id;

        // TODO cfz review below code
        this.applicationResources.addPublication(publicationList);
        // Publish the new publicationList according to spec
        await this.client.publish(
            `oi4/Registry/${this.oi4Id}/pub/publicationList`,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                Payload: this.applicationResources.publicationList,
                DataSetWriterId: CDataSetWriterIdLookup['publicationList'],
                subResource: this.oi4Id
            }], new Date(), DataSetClassIds[Resource.PUBLICATION_LIST])),
        );
    }

    private getAssetType(masterAssetModel: MasterAssetModel): EAssetType
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
            let index = 0;
            const mamPayloadArr: IOPCUADataSetMessage[] = [];
            for (const device of Object.keys(assets)) {
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
                index++;
            }
            const paginatedMessageArray = this.builder.buildPaginatedOPCUANetworkMessageArray(mamPayloadArr, new Date(), DataSetClassIds[Resource.MAM], '', page, perPage);
            for (const networkMessage of paginatedMessageArray) {
                await this.client.publish(`oi4/Registry/${this.oi4Id}/pub/mam`, JSON.stringify(networkMessage));
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
                    await this.client.publish(`oi4/Registry/${this.oi4Id}/pub/mam/${assets[filter].oi4Id}`, JSON.stringify(networkMessage));
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
                    await this.client.publish(`oi4/Registry/${this.oi4Id}/pub/mam/${mamPayloadArr[0].subResource}`, JSON.stringify(networkMessage));
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

                index++;
            }
            const paginatedMessageArray = this.builder.buildPaginatedOPCUANetworkMessageArray(healthPayloadArr, new Date(), DataSetClassIds[Resource.HEALTH], '', page, perPage);
            for (const networkMessage of paginatedMessageArray) {
                await this.client.publish(`oi4/Registry/${this.oi4Id}/pub/health`, JSON.stringify(networkMessage));
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
                        await this.client.publish(`oi4/Registry/${this.oi4Id}/pub/health/${assets[filter].oi4Id}`, JSON.stringify(networkMessage));
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
                        await this.client.publish(`oi4/Registry/${this.oi4Id}/pub/health/${healthPayloadArr[0].subResource}`, JSON.stringify(networkMessage));
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
    async removeDevice(device: string): Promise<void> {
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
            this.client.publish(
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
        this.client.publish(
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
     * Raised in case that the resource has not send a health message within a given time span.
     * @param oi4Id The oi4Id of the asset that has not send a health message.
     */
    async resourceTimeout(oi4Id: string): Promise<void> {
        if (oi4Id in this.assetLookup) {
            const topic = `${this.assetLookup[oi4Id].topicPreamble}/get/$health/${oi4Id}`;
            this.logger.log(`Timeout - Get health on ${topic}.`, ESyslogEventFilter.warning);

            // remove the device 
            await this.removeDevice(oi4Id);

            // last attempt: send a get/health request to the asset 
            // this might re-add the device
            const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[Resource.HEALTH]);
            await this.client.publish(topic, JSON.stringify(networkMessage));
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
    async updateAuditLevel(): Promise<void> {
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
            if (levels === this.applicationResources.settings.logging.auditLevel) {
                return; // We matched our configured auditLevel, returning to not sub to redundant info...
            }
        }

        this.logger.level = this.applicationResources.settings.logging.auditLevel;
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
    async updateConfig(newConfig: IContainerConfig): Promise<void> {
        this.applicationResources.config = newConfig;
        this.logger.log(`Sanity-Check: New config as json: ${JSON.stringify(this.applicationResources.config)}`, ESyslogEventFilter.debug);
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
    get eventTrail(): IReceivedEvent[] {
        return this.globalEventList;
    }

    /**
     * Retrieve the global event list up to a specified amount of elements.
     * @param noOfElements - The amount of elements that is to be retrieved
     * @returns The global event list up to the specified amout of elements 
     */
    public getEventTrail(noOfElements: number): IReceivedEvent[] {
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
