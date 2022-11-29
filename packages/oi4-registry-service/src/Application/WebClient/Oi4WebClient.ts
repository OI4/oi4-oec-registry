import {EventEmitter} from 'events';
import express = require('express');
import bodyParser = require('body-parser');
import cors = require('cors');
import fs = require('fs');
import https = require('https');

import {Logger} from '@oi4/oi4-oec-service-logger';
import {ESyslogEventFilter, IOI4ApplicationResources, IContainerConfig, IOPCUAMetaData, IOPCUANetworkMessage, Oi4Identifier, OPCUABuilder} from '@oi4/oi4-oec-service-model';
import {IOI4Application} from '@oi4/oi4-oec-service-node';

import {StartupConfig} from '../StartupConfig';


export class Oi4WebClient extends EventEmitter {
    protected readonly client: express.Application;
    protected readonly logger: Logger;

    public readonly oi4Id: Oi4Identifier;
    public readonly serviceType: string;
    public applicationResources: IOI4ApplicationResources;
    public topicPreamble: string;
    public readonly builder: OPCUABuilder;

    private readonly version: string;
    private readonly license: string;

    constructor(application: IOI4Application, port = 5799, version: string, license: string) {
        super();

        this.oi4Id = application.oi4Id;
        this.serviceType = application.serviceType;
        this.builder = application.builder;
        this.topicPreamble = application.topicPreamble;
        this.applicationResources = application.applicationResources;
        this.version = version;
        this.license = license;

        const startupConfig = new StartupConfig();
        this.logger = new Logger(true, 'Registry-WebProxy', startupConfig.logLevel, startupConfig.publishingLevel, application.oi4Id, application.serviceType);
        this.logger.log(`WebProxy: standard route: ${this.topicPreamble}`, ESyslogEventFilter.warning);

        this.client = express();
        this.client.use((initReq, initRes, initNext) => {
            // TODO security issue? WebAPI allows calls from any domain.
            initRes.header('Access-Control-Allow-Origin', '*'); // update to match the domain you will make the request from
            initRes.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            initRes.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
            initNext();
            console.log(initRes);
        });
        this.client.use(cors());
        this.client.use(bodyParser.json());
        //this.client.options('*', cors());

        if (startupConfig.useHttps) { // we should use HTTPS, check for key/cert
            if (fs.existsSync(startupConfig.certFile) && fs.existsSync(startupConfig.keyFile)) {
                this.logger.log('Key and Cert exist, using HTTPS for Express...', ESyslogEventFilter.warning);
                https.createServer(
                    {
                        key: fs.readFileSync(startupConfig.keyFile),
                        cert: fs.readFileSync(startupConfig.certFile),
                    },
                    this.client)
                    .listen(port, () => {
                        this.logger.log('WebProxy of Registry listening on port over HTTPS', ESyslogEventFilter.warning);
                    });
            } else {
                this.logger.log('Key and / or Cert dont exist..fallback to HTTP', ESyslogEventFilter.warning);
                this.client.listen(port, () => {
                    this.logger.log(`WebProxy of Registry listening on ${port} over HTTP`, ESyslogEventFilter.warning);
                });
            }
        } else { // No environment variable found, use HTTP
            this.logger.log('USE_HTTPS not set to "true" or not found..fallback to HTTP', ESyslogEventFilter.warning);
            this.client.listen(port, () => {
                this.logger.log(`WebProxy of Registry listening on ${port} over HTTP`, ESyslogEventFilter.warning);
            });
        }

        // Handle Get Requests
        this.client.get('/', (indexReq, indexResp) => {
            indexResp.send(JSON.stringify(this.oi4Id.toString()));
        });

        this.client.get('/packageVersion', (packageVersionReq, packageVersionResp) => {
            packageVersionResp.send(this.version);
        });

        this.client.get('/packageLicense', (packageLicenseReq, packageLicenseResp) => {
            packageLicenseResp.send(this.license);
        });

        this.client.get('/health', (healthReq, healthResp) => {
            healthResp.send(JSON.stringify(this.applicationResources.health));
        });

        this.client.get('/config', (configReq, configResp) => {
            configResp.send(JSON.stringify(this.applicationResources.config));
        });

        this.client.get('/license', (licenseReq, licenseResp) => {
            licenseResp.send(JSON.stringify(this.applicationResources.license));
        });

        this.client.get('/rtLicense', (rtLicenseReq, rtLicenseResp) => {
            rtLicenseResp.send(JSON.stringify(this.applicationResources.rtLicense));
        });

        this.client.get('/mam', (mamReq, mamResp) => {
            mamResp.send(JSON.stringify(this.applicationResources.mam));
        });

        this.client.get('/data/:tagName', (dataReq, dataResp) => {
            dataResp.send(JSON.stringify(this.applicationResources.dataLookup[dataReq.params.tagName]));
        });

        this.client.get('/data', (dataReq, dataResp) => {
            dataResp.send(JSON.stringify(this.applicationResources.dataLookup));
        });

        this.client.get('/metadata/:tagName', (metaDataReq, metaDataResp) => {
            metaDataResp.send(JSON.stringify(this.applicationResources.metaDataLookup[metaDataReq.params.tagName]));
        });

        this.client.get('/metadata', (metaDataReq, metaDataResp) => {
            metaDataResp.send(JSON.stringify(this.applicationResources.metaDataLookup));
        });

        // Handle Put Requests
        this.client.put('/config', (configReq, configResp) => {
            this.updateConfig(configReq.body);
            configResp.send('updatedConfig');
        });

        // Handle Post Requests
        this.client.post('/metadata/:tagName', (metaDataReq, metaDataResp) => {
            this.addMetaData(metaDataReq.params.tagName, metaDataReq.body);
            metaDataResp.send('Executed function');
        });

        this.client.post('/data/:tagName', (dataReq, dataResp) => {
            this.addData(dataReq.params.tagName, dataReq.body);
            dataResp.send(JSON.stringify({return: 'ok'}));
        });

        // Handle Delete Requests
        this.client.delete('/data/:tagName', (dataReq, dataResp) => {
            this.deleteData(dataReq.params.tagName);
            dataResp.send(JSON.stringify({return: 'ok'}));
        });
    }

    get webClient() {
        return this.client;
    }

    updateConfig(configObject: IContainerConfig): void {
        this.applicationResources.config = configObject;
    }

    addMetaData(tagName: string, metadata: IOPCUAMetaData) {
        // This topicObject is also specific to the resource. The data resource will include the TagName!
        const dataLookup = this.applicationResources.dataLookup;
        if (tagName === '') {
            return;
        }
        if (!(tagName in dataLookup) && (typeof metadata !== undefined)) {
            this.applicationResources.metaDataLookup[tagName] = metadata;
            this.logger.log(`Added ${tagName} to metaDataLookup via WebAPI`);
        } else {
            this.logger.log(`${tagName} either already exists or does not carry data in payload`);
        }

    }

    addData(tagName: string, data: IOPCUANetworkMessage) {
        // This topicObject is also specific to the resource. The data resource will include the TagName!
        const dataLookup = this.applicationResources.dataLookup;
        if (tagName === '') {
            return;
        }
        if (!(tagName in dataLookup) && (typeof data !== undefined)) {
            this.applicationResources.dataLookup[tagName] = data;
            this.logger.log(`Added ${tagName} to dataLookup via WebAPI`);
        } else {
            this.logger.log(`${tagName} either already exists or does not carry data in payload`);
        }
    }

    deleteData(tagName: string) {
        const dataLookup = this.applicationResources.dataLookup;
        if (tagName === '') {
            return;
        }
        if (tagName in dataLookup) {
            delete this.applicationResources.dataLookup[tagName];
            this.logger.log(`Deleted ${tagName} from dataLookup via WebAPI`);
        }
        this.logger.log(`${tagName} does not exist in dataLookup`);
    }
}
