import mqtt = require('async-mqtt'); /*tslint:disable-line*/
// DSCIds
import {EventEmitter} from 'events';
import {SequentialTaskQueue} from 'sequential-task-queue';
import {
    DataSetClassIds,
    DataSetWriterIdManager,
    EAssetType,
    EDeviceHealth,
    ESyslogEventFilter,
    Health,
    IContainerConfig,
    IEvent,
    IOI4Resource,
    IOPCUADataSetMessage,
    IOPCUANetworkMessage,
    License,
    LicenseText,
    MasterAssetModel,
    Methods,
    Oi4Identifier,
    OPCUABuilder,
    Profile,
    PublicationList,
    PublicationListConfig,
    Resources,
    RTLicense,
    ServiceTypes,
    SubscriptionList,
    SubscriptionListConfig,
} from '@oi4/oi4-oec-service-model';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {FileLogger, TopicInfo, TopicParser} from '@oi4/oi4-oec-service-node';
import {ConformityValidator, EValidity, IConformity} from '@oi4/oi4-oec-service-conformity-validator';
import {IAsset, IAssetEvent, IResourceObject} from '../Models/IRegistry';
import {ELogType, ISettings} from '../Models/ISettings';
import {RegistryResources, settingChangedEvent} from '../RegistryResources';
import {StartupConfig} from '../StartupConfig';
import {AssetLookup} from '../Models/AssetLookup';

interface PaginationPub {
    TotalCount: number;
    PerPage: number;
    Page: number;
    HasNext: boolean;
}


export class Registry extends EventEmitter {
    private readonly assetLookup: AssetLookup;
    private readonly oi4DeviceWildCard: string;
    private readonly oi4Id: Oi4Identifier;
    private readonly applicationResources: RegistryResources;
    private readonly maxAuditTrailElements: number;
    private readonly timeoutLookup: any;

    private client: mqtt.AsyncClient;
    private globalEventList: IAssetEvent[];
    private builder: OPCUABuilder;
    private logger: Logger;
    private queue: SequentialTaskQueue;
    private logToFileEnabled: ELogType;
    private logHappened: boolean;
    private fileLogger: FileLogger;

    private flushTimeout: any;

    // Timeout container TODO: types
    private conformityValidator: ConformityValidator;

    /**
     * The constructor of the Registry
     * @param client The global mqtt client used to avoid multiple client connections inside the container
     * @param appResources The containerState of the OI4-Service holding information about the oi4Id etc.
     * @param startupConfig
     */
    constructor(client: mqtt.AsyncClient, appResources: RegistryResources, startupConfig: StartupConfig) {
        super();

        this.assetLookup = new AssetLookup();
        this.oi4Id = appResources.oi4Id;
        this.logToFileEnabled = appResources.settings.logging.logType;
        // Config section
        appResources.eventEmitter.on(settingChangedEvent, (oldSettings: ISettings, newSettings: ISettings) => {
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

        const logLevel = startupConfig.logLevel;
        const publishingLevel = startupConfig.publishingLevel;

        this.logger = new Logger(true, 'Registry-App', logLevel, publishingLevel, this.oi4Id, appResources.mam.getServiceType(), client);
        this.fileLogger = new FileLogger(appResources.settings.logging.logFileSize);

        this.queue = new SequentialTaskQueue();
        this.applicationResources = appResources;

        this.timeoutLookup = {};
        this.oi4DeviceWildCard = 'Oi4/+/+/+/+/+';
        this.globalEventList = [];
        this.assetLookup = new AssetLookup();
        this.maxAuditTrailElements = 100;
        this.logHappened = false;

        this.builder = new OPCUABuilder(this.oi4Id, appResources.mam.getServiceType());
        this.conformityValidator = new ConformityValidator(this.oi4Id, client, appResources.mam.getServiceType());
        this.client = client;

        this.client.on('connect', async () => this.onClientConnect());

        // setInterval(() => { this.flushToLogfile; }, 60000); // TODO: Re-enable
    }

    private async onClientConnect(): Promise<void> {
        await this.initSubscriptions();
        this.client.on('message', this.processMqttMessage);

        const topicInfo = {
            topic: '',
            appId: this.oi4Id,
            method: Methods.PUB,
            resource: Resources.MAM,
            oi4Id: this.oi4Id,
            serviceType: ServiceTypes.REGISTRY,
        } as TopicInfo;
        const networkMessage = this.builder.buildOPCUANetworkMessage([{
            Source: this.oi4Id,
            Payload: this.applicationResources.mam,
            DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(Resources.MAM, this.oi4Id),
        }], new Date(), DataSetClassIds[Resources.MAM]);
        await this.addToRegistry(topicInfo, networkMessage);

        // In most cases the mam for the registry was already published via the OI4 service node component
        // --> We publish the mam again so that the registry detects 'itself' and to enforce validation of the registry
        // TODO: Instead publishing of the mam again we could also call addToRegistry for ourself
        // const mam = this.applicationResources.mam;
        // await this.client.publish(`Oi4/${mam.getServiceType()}/${this.oi4Id}/Pub/MAM/${this.oi4Id}`,
        //     JSON.stringify(this.builder.buildOPCUANetworkMessage([{
        //         Source: this.oi4Id,
        //         Payload: this.applicationResources.mam,
        //         DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(Resources.MAM, this.oi4Id),
        //     }], new Date(), DataSetClassIds[Resources.MAM])),
        // );
    }

    private async initSubscriptions(): Promise<void> {

        await this.ownSubscribe(`${this.oi4DeviceWildCard}/Pub/MAM/#`); // Add Asset to Registry
        await this.ownSubscribe(`${this.oi4DeviceWildCard}/Pub/Health/#`); // Add Asset to Registry
        await this.ownSubscribe(`${this.oi4DeviceWildCard}/Pub/AAS/#`); // Add Asset to Registry
        await this.ownSubscribe('Oi4/Registry/+/+/+/+/Get/MAM/#');
    }

    /**
     * Overrides the default mqtt-subscription in order to automatically adjust the 'subscriptionList' resource
     * @param topic - The topic that should be subscribed to
     */
    private async ownSubscribe(topic: string): Promise<mqtt.ISubscriptionGrant[]> {

        const subscription = new SubscriptionList();
        subscription.TopicPath = topic;
        subscription.Config = SubscriptionListConfig.NONE_0;
        subscription.Interval = 0;

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

    private removeSubscriptionByTopic(topic: string): void {
        for (let i = 0; i < this.applicationResources.subscriptionList.length; i++) {
            if (this.applicationResources.subscriptionList[i].TopicPath == topic) {
                this.applicationResources.subscriptionList.splice(i--, 1)
            }
        }
    }

    /**
     * Wrapper function for the File-Logger flushToFile. Behaviour:
     * If logging is not enabled, we skip flushing to file and instead shift the array (in order not to overfill the rambuffer)
     * If it's enabled and no logs happened, we can simply return and re-set the timeout (no need to shift since the array should be empty)
     */
    private flushToLogfile(): void {
        if (this.logToFileEnabled === ELogType.enabled) {
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

        // // Skip PUB messages of the registry itself
        // if (topicInfo.serviceType === ServiceTypes.REGISTRY && topicInfo.method === Methods.PUB) {
        //     return;
        // }

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
            this.logger.log(`Errors: ${this.builder.jsonValidator.errors}`, ESyslogEventFilter.debug)
            return;
        }

        // Safety-Check: DataSetClassId
        if (networkMessage.DataSetClassId !== DataSetClassIds[topicInfo.resource]) {
            this.logger.log(`Error in pre-check, dataSetClassId mismatch, got ${networkMessage.DataSetClassId}, expected ${DataSetClassIds[topicInfo.resource]}`, ESyslogEventFilter.warning);
            return;
        }

        if (this.assetLookup.has(topicInfo.source)) { // If we've got this oi4Id in our lookup, we update its "life-sign", even if the payload might be wrong later on
            const asset = this.assetLookup.get(topicInfo.source);
            asset.lastMessage = new Date().toISOString();
        }

        switch (topicInfo.method) {
            case Methods.PUB:
                await this.processPubActions(topicInfo, networkMessage);
                break;
        }
    }

    private async processPubActions(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {
        if (topicInfo.method !== Methods.PUB) {
            throw new Error('Invalid argument topicInfo. Method must be TopicMethods.PUB.')
        }

        if (networkMessage.Messages.length === 0) { // In pub, we do not expect empty messages, they always need at least one entry
            this.logger.log('Messages Array empty in pub - check DataSetMessage format', ESyslogEventFilter.warning);
            return;
        }

        switch (topicInfo.resource) {
            case Resources.MAM:
                await this.addToRegistry(topicInfo, networkMessage);
                break;
            case Resources.EVENT:
                await this.processPublishedEvent(topicInfo, networkMessage);
                break;
            case Resources.HEALTH:
                await this.processPublishedHealth(topicInfo, networkMessage);
                break;
            case Resources.LICENSE:
                await Registry.processMessage(networkMessage, (m) => this.updateResource(m, (r) => r.License = License.clone(m.Payload)));
                break;
            case Resources.RT_LICENSE:
                await Registry.processMessage(networkMessage, (m) => this.updateResource(m, (r) => {
                    const rtLicense = new RTLicense();
                    Object.assign(rtLicense, m.Payload);
                    r.RtLicense = rtLicense;
                }));
                break;
            case Resources.LICENSE_TEXT:
                await Registry.processMessage(networkMessage, (m) => this.updateResource(m, (r) => r.LicenseText = LicenseText.clone(m.Payload)));
                break;
            case Resources.CONFIG:
                await Registry.processMessage(networkMessage, (m) => this.updateResource(m, (r) => r.Config = JSON.parse(JSON.stringify(m.Payload))));
                break;
            case Resources.PROFILE:
                await Registry.processMessage(networkMessage, (m) => this.updateResource(m, (r) => r.Profile = Profile.clone(m.Payload)));
                break;
            // case Resources.AAS:
            //     await Registry.processMessage(networkMessage, (m) => this.updateResource(m, (r) => r.AAS = AAS.clone(m.Payload)));
            //     break;
            default:
                this.logger.log(`${topicInfo.resource} not supported and will be skipped`, ESyslogEventFilter.informational);
                break;
        }
    }

    private static async processMessage(input: IOPCUANetworkMessage, proc: (m: IOPCUADataSetMessage) => void, pagination?: (p: PaginationPub) => void): Promise<void> {
        let paginationPub: PaginationPub;

        for (const dataSetMessage of input.Messages) {

            if (typeof dataSetMessage.Payload.Page !== 'undefined') { // found pagination
                paginationPub =
                    {
                        TotalCount: dataSetMessage.Payload.TotalCount,
                        PerPage: dataSetMessage.Payload.PerPage,
                        Page: dataSetMessage.Payload.Page,
                        HasNext: dataSetMessage.Payload.HasNext
                    };

                continue;
            }

            proc(dataSetMessage);
        }

        if (pagination !== undefined && paginationPub !== undefined && paginationPub.HasNext) {
            pagination(paginationPub);
        }
    }

    private updateResource(dataSetMessage: IOPCUADataSetMessage, update: (asset: IResourceObject) => void): void {
        const oi4Id = dataSetMessage.Source;

        if (oi4Id != undefined && this.assetLookup.has(oi4Id)) {
            const asset = this.assetLookup.get(oi4Id);
            update(asset.resources)
        }
    }

    private async requestNextPage(pagination: PaginationPub, topicInfo: TopicInfo): Promise<void> {

        const paginationGet = {
            perPage: pagination.PerPage, // get same amout of data
            page: ++pagination.Page // get next page
        };

        let topic: string;
        let source: Oi4Identifier;
        let filter: string;
        switch (topicInfo.resource) {

            // TODO fix topics (source is missing)
            case Resources.EVENT:
                if (topicInfo.filter !== undefined) {
                    topic = `Oi4/${topicInfo.serviceType}/${topicInfo.appId}/Get/${topicInfo.resource}/${topicInfo.category}/${topicInfo.filter}`;
                    source = topicInfo.source;
                    filter = topicInfo.filter;
                } else {
                    topic = `Oi4/${topicInfo.serviceType}/${topicInfo.appId}/Get/${topicInfo.resource}/${topicInfo.category}`;
                    source = topicInfo.source;
                }
                break;

            default:
                if (topicInfo.source !== undefined) {
                    topic = `Oi4/${topicInfo.serviceType}/${topicInfo.appId}/Get/${topicInfo.resource}/${topicInfo.source}`
                    source = topicInfo.source;
                } else {
                    topic = `Oi4/${topicInfo.serviceType}/${topicInfo.appId}/Get/${topicInfo.resource}`;
                    source = topicInfo.appId;
                }
                break;

        }

        await this.client.publish(topic,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                Source: source,
                Filter: filter,
                Payload: paginationGet,
                DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(topicInfo.resource, this.oi4Id),
            }], new Date(), DataSetClassIds[topicInfo.resource])),
        );

    }

    private async processPublishedEvent(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {
        this.logHappened = true; // We got some form of logs

        if (this.globalEventList.length >= this.maxAuditTrailElements) {
            // If we have too many elements in the list, we purge them
            clearTimeout(this.flushTimeout);
            this.flushToLogfile(); // This will also shift the array if there are too many entries!
        }

        await Registry.processMessage(networkMessage, (m) => {
                const parsedPayload: IEvent = m.Payload;
                const topicParts = topicInfo.toString().split('/');

                const assetEvent: IAssetEvent = {
                    origin: m.Source.toString(),
                    level: topicParts[topicParts.length - 1],
                    number: parsedPayload.Number,
                    category: parsedPayload.Category,
                    description: parsedPayload.Description,
                    details: parsedPayload.Details,
                    timestamp: m.Timestamp ?? new Date().toISOString()
                }

                this.globalEventList.push(assetEvent);

            },
            async (pagination) => this.requestNextPage(pagination, topicInfo));
    }

    private async processPublishedHealth(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {

        await Registry.processMessage(networkMessage, async (m) => {
                const oi4Id = m.Source;
                this.logger.log(`Got Health from ${oi4Id}.`);

                const health = Health.clone(m.Payload);

                if (this.assetLookup.has(oi4Id)) {
                    this.logger.log(`Resetting timeout from health for oi4Id: ${oi4Id}`, ESyslogEventFilter.warning);
                    // This timeout will be called regardless of enable-setting. Every 60 seconds we need to manually poll health
                    clearTimeout(this.timeoutLookup[oi4Id.toString()]);

                    if (health.Health === EDeviceHealth.FAILURE_1 && health.HealthScore === 0) {
                        this.logger.log(`Kill-Message detected in Asset: ${oi4Id}, setting availability to false.`, ESyslogEventFilter.warning);
                        await this.removeDevice(oi4Id);
                    } else {
                        this.timeoutLookup[oi4Id.toString()] = setTimeout(() => this.resourceTimeout(oi4Id), 65000);

                        const asset = this.assetLookup.get(oi4Id);
                        asset.lastMessage = new Date().toISOString();
                        asset.resources.Health = health;
                    }
                    this.logger.log(`Setting health of ${oi4Id} to: ${JSON.stringify(health)}`);
                } else {
                    if (topicInfo.appId === this.oi4Id) return;

                    const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[Resources.MAM]);
                    const topic = `Oi4/${topicInfo.serviceType}/${topicInfo.appId}/Get/MAM/${oi4Id}`;
                    await this.client.publish(topic, JSON.stringify(networkMessage));
                    this.logger.log(`Got a health from unknown Asset, requesting mam on ${topic}`, ESyslogEventFilter.debug);
                }
            },
            async (pagination) => this.requestNextPage(pagination, topicInfo));
    }

    /**
     * If we receive a pubMam Event from the MessageBusProxy, we check if that Mam is already in our Registry lookup
     * If not, we add it to the registry, if yes, we don't.
     */
    async addToRegistry(topicInfo: TopicInfo, networkMessage: IOPCUANetworkMessage): Promise<void> {

        await Registry.processMessage(networkMessage, async (m) => {
                const assetId = m.Source;

                if (this.getAsset(assetId)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
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
            },
            async (pagination) => this.requestNextPage(pagination, topicInfo));
    }

    /**
     * Adds an asset based on the topic it registered on and its MasterAssetModel to the registry.
     * The asset is either classified into a device or an application
     * @param topicInfo The topic that contains information about the device being added
     * @param masterAssetModel The MasterAssetModel of the device
     */
    async addAsset(topicInfo: TopicInfo, masterAssetModel: MasterAssetModel): Promise<void> {
        this.logger.log(`----------- ADDING ASSET ----------:  ${topicInfo.toString()}`, ESyslogEventFilter.informational);

        if (Object.keys(masterAssetModel).length === 0) {
            this.logger.log('Critical Error: MAM of device to be added is empty', ESyslogEventFilter.error);
            return;
        }
        const oi4Id: Oi4Identifier = topicInfo.source !== undefined ? topicInfo.source : topicInfo.appId;

        if (this.getAsset(oi4Id)) { // If many Mams come in quick succession, we have no chance of checking duplicates prior to this line
            this.logger.log('--MasterAssetModel already in Registry - addDevice--', ESyslogEventFilter.debug);
            return;
        }

        if (!oi4Id.equals(this.oi4Id) && !this.applicationResources.getSource(oi4Id)) {
            const source: IOI4Resource = {
                oi4Id: oi4Id,
                profile: undefined,
                mam: masterAssetModel,
                health: undefined,
                license: undefined,
                licenseText: undefined,
                rtLicense: undefined,
                config: undefined,
                publicationList: undefined,
                subscriptionList: undefined,
                referenceDesignation: undefined,
                //aas: undefined
            };

            this.applicationResources.addSource(source);
        }

        const assetType = Registry.getAssetType(masterAssetModel);
        const registeredAt = new Date().toISOString();
        const newAsset: IAsset = {
            oi4IdOriginator: topicInfo.appId,
            oi4Id: oi4Id,
            lastMessage: registeredAt,
            registeredAt: registeredAt,
            resources: {
                MAM: masterAssetModel,
            },
            topicPreamble: `Oi4/${topicInfo.serviceType}/${topicInfo.appId}`,
            conformityObject: {
                oi4Id: EValidity.default,
                validity: EValidity.default,
                checkedResourceList: [],
                profileResourceList: [],
                nonProfileResourceList: [],
                resources: {}
            },
            assetType: assetType
        };
        console.log(masterAssetModel);
        if (assetType === EAssetType.application) {
            this.logger.log('___Adding Application___', ESyslogEventFilter.debug);
        } else {
            this.logger.log('___Adding Device___', ESyslogEventFilter.debug);
        }

        this.assetLookup.set(oi4Id, newAsset);

        // Subscribe to all changes regarding this application
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/Event/${oi4Id}/#`);
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/Health/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/License/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/RtLicense/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/LicenseText/#`);
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/Config/${oi4Id}`);
        this.ownSubscribe(`${newAsset.topicPreamble}/Pub/Profile/${oi4Id}`);
        //this.ownSubscribe(`${newAsset.topicPreamble}/Pub/AAS/${oi4Id}`);

        newAsset.conformityObject = await this.conformityValidator.checkConformity(assetType, newAsset.topicPreamble, oi4Id);

        // Update own publicationList with new Asset
        const publicationList = new PublicationList();
        publicationList.Resource = Resources.MAM;
        publicationList.DataSetWriterId = 0;
        publicationList.Config = PublicationListConfig.NONE_0;
        publicationList.Interval = 0;
        publicationList.Source = oi4Id;

        this.applicationResources.addPublication(publicationList);
        // Publish the new publicationList according to spec
        await this.client.publish(
            `Oi4/Registry/${this.oi4Id}/Pub/PublicationList`,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                Payload: this.applicationResources.publicationList,
                DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(Resources.PUBLICATION_LIST, this.oi4Id),
                Source: this.oi4Id
            }], new Date(), DataSetClassIds[Resources.PUBLICATION_LIST])),
        );
    }

    private static getAssetType(masterAssetModel: MasterAssetModel): EAssetType {
        // OEC development specification section 4 (mam) about the 'HardwareRevision':
        // An application (software only) might be listed as an asset and therefore also has a nameplate.
        // In this case, the HardwareRevision shall be set to an empty string to detect the differences
        // between hardware and software only assets!
        if (masterAssetModel.HardwareRevision === '') {
            return EAssetType.application;
        }

        return EAssetType.device;
    }


    private removePublicationBySubResource(subResource: string): void {
        for (let i = 0; i < this.applicationResources.publicationList.length; i++) {
            if (this.applicationResources.publicationList[i].Source == Oi4Identifier.fromString(subResource)) {
                this.applicationResources.publicationList.splice(i--, 1)
            }
        }
    }


    /**
     * Removes an asset from the assetLookup
     * @param oi4Id - the oi4Id of the device that is to be removed
     */
    async removeDevice(oi4Id: Oi4Identifier): Promise<void> {
        if (this.assetLookup.has(oi4Id)) {
            const asset = this.assetLookup.get(oi4Id);

            this.applicationResources.removeSource(oi4Id);


            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Event/${oi4Id}/#`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Health/${oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/License/${oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/RtLicense/${oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/LicenseText/#`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Config/${oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Profile/${oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/AAS/${oi4Id}`);
            this.assetLookup.delete(oi4Id);
            // Remove from publicationList
            this.removePublicationBySubResource(oi4Id.toString());
            // Publish the new publicationList according to spec
            this.client.publish(
                `Oi4/Registry/${this.oi4Id}/Pub/PublicationList`,
                JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                    Payload: this.applicationResources.publicationList,
                    DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(Resources.PUBLICATION_LIST, this.oi4Id),
                    Source: this.oi4Id,
                }], new Date(), DataSetClassIds[Resources.PUBLICATION_LIST])),
            );
            this.logger.log(`Deleted App: ${oi4Id}`, ESyslogEventFilter.warning);
        } else {
            this.logger.log('Nothing to remove here!', ESyslogEventFilter.debug);
        }
    }

    /**
     * Clears the entire Registry by removing every asset from the assetLookup
     */
    clearRegistry(): void {
        for (const asset of this.assetLookup) { // Unsubscribe topics of every asset
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Health/${asset.oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/License/${asset.oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/RtLicense/${asset.oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/LicenseText/#`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Config/${asset.oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/Profile/${asset.oi4Id}`);
            this.ownUnsubscribe(`${asset.topicPreamble}/Pub/AAS/${asset.oi4Id}`);
            // Remove from publicationList
            this.removePublicationBySubResource(asset.oi4Id.toString());
        }
        // Publish the new publicationList according to spec
        this.client.publish(
            `Oi4/Registry/${this.oi4Id}/Pub/PublicationList`,
            JSON.stringify(this.builder.buildOPCUANetworkMessage([{
                Payload: this.applicationResources.publicationList,
                DataSetWriterId: DataSetWriterIdManager.getDataSetWriterId(Resources.PUBLICATION_LIST, this.oi4Id),
                Source: this.oi4Id
            }], new Date(), DataSetClassIds[Resources.PUBLICATION_LIST])),
        );

        this.assetLookup.clear(); // Clear asset lookup
    }

    /**
     * Runs a conformity check on an asset by utilizing the ConformityValidator and returns the conformity Object.
     * @param oi4Id The oi4Id of the asset that is to be checked for conformity
     * @param resourceList The resourceList that is to be checked for conformity
     */
    async updateConformityInDevice(oi4Id: Oi4Identifier, resourceList: Resources[]): Promise<IConformity> {
        this.logger.log(`Checking conformity for ${oi4Id}`);
        let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
        if (this.assetLookup.has(oi4Id)) {
            const asset = this.assetLookup.get(oi4Id);
            conformityObject = await this.conformityValidator.checkConformity(asset.assetType, asset.topicPreamble, asset.oi4Id, resourceList);
            asset.conformityObject = conformityObject;
        }
        return conformityObject;
    }


    /**
     * Raised in case that the resource has not send a health message within a given time span.
     * @param oi4Id The oi4Id of the asset that has not send a health message.
     */
    async resourceTimeout(oi4Id: Oi4Identifier): Promise<void> {
        if (this.assetLookup.has(oi4Id)) {
            const asset = this.assetLookup.get(oi4Id);
            const topic = `${asset.topicPreamble}/Get/$Health/${oi4Id}`;
            this.logger.log(`Timeout - Get health on ${topic}.`, ESyslogEventFilter.warning);

            // remove the device
            await this.removeDevice(oi4Id);

            // last attempt: send a get/health request to the asset
            // this might re-add the device
            const networkMessage = this.builder.buildOPCUANetworkMessage([], new Date, DataSetClassIds[Resources.HEALTH]);
            await this.client.publish(topic, JSON.stringify(networkMessage));
        }
    }


    /**
     * Retrieves a specific resource from an asset via its oi4Id. This includes devices and applications
     * @param oi4Id The oi4Id of the Asset that provides the resource
     * @param resource The name of the resource that needs to be retireved
     */
    getResourceFromLookup(oi4Id: Oi4Identifier, resource: string) {
        // TODO: Resource intensive, we should push to the error object only if we actually have an error
        // FIXME: Better yet, don't separate between device and application lookup
        const oi4ToObjectList: IAsset[] = [];
        if (this.assetLookup.has(oi4Id)) {
            const asset = this.assetLookup.get(oi4Id);
            oi4ToObjectList.push(asset);
            if (resource === 'lastMessage') {
                return asset.lastMessage;
            }

            if ('resources' in asset) {
                if (resource in asset.resources) {
                    return asset.resources[resource];
                }
            }
        }
        return {
            err: 'Could not get resource from registry',
            foundObjects: oi4ToObjectList,
        };
    }


    /**
     * Updates the subscription of the audit trail to match the config
     * Attention. This clears all saved lists (global + assets)
     */
    async updateAuditLevel(): Promise<void> {
        // First, clear all old eventLists
        this.globalEventList = [];

        // TODO: Whats the purpose of the below code?

        // Then, unsubscribe from old Audit Trail
        for (const levels of Object.values(ESyslogEventFilter)) {
            console.log(`Unsubscribed syslog trail from ${levels}`);
            await this.ownUnsubscribe('Oi4/+/+/+/+/+/Pub/Event/#');
        }
        // Then, resubscribe to new Audit Trail
        for (const levels of Object.values(ESyslogEventFilter)) {
            console.log(`Resubscribe to syslog category - ${levels}`);
            await this.ownSubscribe('Oi4/+/+/+/+/+/Pub/Event/#');
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
    deleteFiles(): string[] {
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
     * @returns {IAsset[]} The applicationLookup of the Registry
     */
    get applications() {
        const allAssets = [...this.assetLookup];
        return allAssets.filter(a => a.assetType === EAssetType.application);
    }

    /**
     * Getter for deviceLookup
     * @returns {IAsset[]} The deviceLookup of the Registry
     */
    get devices() {
        const allAssets = [...this.assetLookup];
        return allAssets.filter(a => a.assetType === EAssetType.device);
    }

    /**
     * Gets the global event list.
     * @returns The global event list.
     */
    get eventTrail(): IAssetEvent[] {
        return this.globalEventList;
    }

    /**
     * Retrieve the global event list up to a specified amount of elements.
     * @param noOfElements - The amount of elements that is to be retrieved
     * @returns The global event list up to the specified amout of elements
     */
    public getEventTrail(noOfElements: number): IAssetEvent[] {
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
    getAsset(oi4Id: Oi4Identifier): IAsset | undefined {
        if (this.assetLookup.has(oi4Id)) {
            return this.assetLookup.get(oi4Id);
        }
    }

    /**
     * Retrieves the oi4Id of the registry
     */
    getOi4Id(): Oi4Identifier {
        return this.oi4Id;
    }

    private static parseIdentifier(value: string): Oi4Identifier | undefined {
        try {
            return Oi4Identifier.fromString(value);

        } catch {
            return undefined;
        }
    }
}
