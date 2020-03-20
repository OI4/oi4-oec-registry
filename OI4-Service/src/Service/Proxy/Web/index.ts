import express = require('express');
import bodyParser = require('body-parser');
import cors = require('cors');
import fs = require('fs');
import https = require('https');
import { IContainerState, IContainerConfig } from '../../Container/index';
import { OI4Proxy } from '../index.js';
import { IOPCUAData, IOPCUAMetaData } from '../../Models/IOPCUAPayload';
import { Logger } from '../../Utilities/Logger';
import { ESubResource } from '../../Models/IContainer';

class OI4WebProxy extends OI4Proxy {
  private client: express.Application;
  private logger: Logger;
  constructor(container: IContainerState) {
    super(container);
    this.logger = new Logger(true, 'Registry-WebProxy', ESubResource.info);
    this.logger.log(`WebProxy: Standardroute: ${this.standardRoute}`, ESubResource.info);

    this.client = express();
    this.client.use((initReq, initRes, initNext) => {
      initRes.header('Access-Control-Allow-Origin', '*'); // update to match the domain you will make the request from
      initRes.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      initRes.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      initNext();
    });
    this.client.use(cors());
    this.client.use(bodyParser.json());
    this.client.options('*', cors());
    if ((process.env.CERT_PATH)) { // Environment variable found, so we should use HTTPS, check for key/cert
      if (fs.existsSync(`${process.env.CERT_PATH}/cert.pem`) && fs.existsSync(`${process.env.CERT_PATH}/key.pem`)) {
        this.logger.log('Key and Cert exist, using HTTPS for Express...', ESubResource.info);
        https.createServer(
          {
            key: fs.readFileSync(`${process.env.CERT_PATH}/key.pem`),
            cert: fs.readFileSync(`${process.env.CERT_PATH}/cert.pem`),
          },
          this.client)
          .listen(4567, () => {
            this.logger.log('WebProxy of Registry listening on 4567 over HTTPS', ESubResource.info);
          });
      } else {
        this.logger.log('Key and / or Cert dont exist..fallback to HTTP', ESubResource.info);
        this.client.listen(4567, () => {
          this.logger.log('WebProxy of Registry listening on 4567 over HTTP', ESubResource.info);
        });
      }
    } else { // No environment variable found, use HTTP
      this.logger.log('No CERT_PATH environment variable found..fallback to HTTP', ESubResource.info);
      this.client.listen(4567, () => {
        this.logger.log('WebProxy of Registry listening on 4567 over HTTP', ESubResource.info);
      });
    }

    // Handle Get Requests
    this.client.get('/', (indexReq, indexResp) => {
      indexResp.send(JSON.stringify(this.appId));
    });

    this.client.get('/health', (healthReq, healthResp) => {
      healthResp.send(JSON.stringify(this.containerState.health));
    });

    this.client.get('/config', (configReq, configResp) => {
      configResp.send(JSON.stringify(this.containerState.config));
    });

    this.client.get('/license', (licenseReq, licenseResp) => {
      licenseResp.send(JSON.stringify(this.containerState.license));
    });

    this.client.get('/rtLicense', (rtLicenseReq, rtLicenseResp) => {
      rtLicenseResp.send(JSON.stringify(this.containerState.rtLicense));
    });

    this.client.get('/mam', (mamReq, mamResp) => {
      mamResp.send(JSON.stringify(this.containerState.mam));
    });

    this.client.get('/data/:tagName', (dataReq, dataResp) => {
      dataResp.send(JSON.stringify(this.containerState.dataLookup[dataReq.params.tagName]));
    });

    this.client.get('/data', (dataReq, dataResp) => {
      dataResp.send(JSON.stringify(this.containerState.dataLookup));
    });

    this.client.get('/metadata/:tagName', (metaDataReq, metaDataResp) => {
      metaDataResp.send(JSON.stringify(this.containerState.metaDataLookup[metaDataReq.params.tagName]));
    });

    this.client.get('/metadata', (metaDataReq, metaDataResp) => {
      metaDataResp.send(JSON.stringify(this.containerState.metaDataLookup));
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
      dataResp.send(JSON.stringify({ return: 'ok' }));
    });

    // Handle Delete Requests
    this.client.delete('/data/:tagName', (dataReq, dataResp) => {
      this.deleteData(dataReq.params.tagName);
      dataResp.send(JSON.stringify({ return: 'ok' }));
    });
  }

  get webClient() {
    return this.client;
  }

  updateConfig(configObject: IContainerConfig) {
    this.containerState.config = configObject;
  }

  addMetaData(tagName: string, metadata: IOPCUAMetaData) {
    // This topicObject is also specific to the resource. The data resource will include the TagName!
    const dataLookup = this.containerState.dataLookup;
    if (tagName === '') {
      return;
    }
    if (!(tagName in dataLookup) && (typeof metadata !== undefined)) {
      this.containerState.metaDataLookup[tagName] = metadata;
      this.logger.log(`Added ${tagName} to metaDataLookup via WebAPI`);
    } else {
      this.logger.log(`${tagName} either already exists or does not carry data in payload`);
    }

  }

  addData(tagName: string, data: IOPCUAData) {
    // This topicObject is also specific to the resource. The data resource will include the TagName!
    const dataLookup = this.containerState.dataLookup;
    if (tagName === '') {
      return;
    }
    if (!(tagName in dataLookup) && (typeof data !== undefined)) {
      this.containerState.dataLookup[tagName] = data;
      this.logger.log(`Added ${tagName} to dataLookup via WebAPI`);
    } else {
      this.logger.log(`${tagName} either already exists or does not carry data in payload`);
    }
  }

  deleteData(tagName: string) {
    const dataLookup = this.containerState.dataLookup;
    if (tagName === '') {
      return;
    }
    if (tagName in dataLookup) {
      delete this.containerState.dataLookup[tagName];
      this.logger.log(`Deleted ${tagName} from dataLookup via WebAPI`);
    }
    this.logger.log(`${tagName} does not exist in dataLookup`);
  }
}

export { OI4WebProxy };
