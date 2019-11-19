import { OI4MessageBusProxy } from './Service/Proxy/Messagebus/index';
import { OI4WebProxy } from './Service/Proxy/Web/index';
import { ContainerState } from './Service/Container/index';
import { Logger } from './Service/Utilities/Logger/index';
import dotenv from 'dotenv';
import path from 'path';

// Here, we get our configuration from Environment variables. If either of them is not specified, we use a provided .env file
if (!(process.env.OI4_ADDR) || !(process.env.OI4_PORT) || !(process.env.CONTAINERNAME)) {
  dotenv.config({ path: path.join(__dirname, '.env') });
}

const contState = new ContainerState();
const busProxy = new OI4MessageBusProxy(contState);
const webProxy = new OI4WebProxy(contState);
const logger = new Logger(true, 1, busProxy.mqttClient, busProxy.appId, busProxy.serviceType);

// -------- Registry Application
import { Registry } from './Application/Registry';

const registry = new Registry(logger, busProxy.mqttClient);
/**
 * If we receive a pubMam Event from the MessageBusProxy, we check if that Mam is already in our Registry lookup
 * If not, we add it to the registry, if yes, we don't.
 */
busProxy.on('pubMam', async (mqttObj) => {
  const topicArr = mqttObj.topic.split('/');
  const assetId = `${topicArr[8]}/${topicArr[9]}/${topicArr[10]}/${topicArr[11]}`; // this is the OI4-ID of the Asset
  if (registry.getApplication(assetId) || registry.getDevice(assetId)) {
    logger.log('MasterAssetModel already in Registry');
  } else {
    try {
      await registry.addDevice(mqttObj.topic, mqttObj.message);
    } catch (addErr) {
      logger.log('App.ts: Add-Error');
    }
  }
});

/**
 * Deletes a Mam from the registry (TODO: this is not specified yet and only used for debug purposes)
 */
busProxy.on('deleteMam', async (deleteId) => {
  try {
    await registry.removeDevice(deleteId);
  } catch (delErr) {
    logger.log('App.ts: Del-Error');
  }
});

/**
 * If we receive a getMam Event from the MessageBusProxy, we lookup the Mam in our Registry.
 * TODO: Currently, only an empty Tag is supported, which leads to a publish of ALL Mam Data on /pub/mam/<oi4Id>
 */
busProxy.on('getMam', async (tag) => {
  if (tag === '') {
    const devices = registry.applications as IDeviceLookup;
    logger.log(`Sending all known Mams...count: ${Object.keys(devices).length}`);
    for (const device of Object.keys(devices)) {
      // TODO: URL ENCODING????
      await busProxy.mqttClient.publish(`oi4/Registry/${busProxy.appId}/pub/mam/${devices[device].resources.mam.ProductInstanceUri}`, JSON.stringify(busProxy.builder.buildOPCUADataMessage(devices[device].resources.mam, new Date(), 'registryClassID')));
      logger.log(`Sent device with OI4-ID ${devices[device].resources.mam.ProductInstanceUri}`);
    }
  } else {
    logger.log(`Sending Mam with Requested tag: ${tag} <-- Not implemented!`);
  }
});

// --- WEBCLIENT: Take exposed webClient from webProxy and add custom routes ----
const webClient = webProxy.webClient;

webClient.get('/registry/application', (deviceReq, deviceResp) => {
  deviceResp.send(JSON.stringify(registry.applications));
});

webClient.get('/registry/device', (deviceReq, deviceResp) => {
  deviceResp.send(JSON.stringify(registry.devices));
});

// In this resourceList, eventList, lastMessage and mam are custom resources only used by the registry
const resourceList = ['health', 'config', 'profile', 'license', 'rtLicense', 'licenseText', 'eventList', 'lastMessage', 'mam'];

for (const resources of resourceList) {
  webClient.get(`/registry/${resources}/:oi4Id`, async (resourceReq, resourceResp) => {
    let resourceObject;
    try {
      resourceObject = await registry.getResourceFromLookup(resourceReq.params.oi4Id, resources);
      if (resourceObject === null || resourceObject === undefined) {
        logger.log(`Should never happen, in /registry/resources/:oi4Id ${resources}`);
      }
    } catch (getResourceErr) {
      resourceObject = getResourceErr;
    }
    resourceResp.send(JSON.stringify(resourceObject));
  });
}

webClient.get('/registry/event', (deviceHealthReq, deviceHealthResp) => {
  deviceHealthResp.send(JSON.stringify(registry.eventTrail));
});

// -------- Conformity Checker Application
import { ConformityValidator } from './Application/ConformityValidator';
import { IDeviceLookup } from './Application/Models/IRegistry';

const confChecker = new ConformityValidator(logger, contState.appId);
webClient.get('/conformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
  let conformityObject = confChecker.initializeValidityObject();
  try {
    conformityObject = await confChecker.checkConformity(conformityReq.params.originator, conformityReq.params.oi4Id);
  } catch (err) {
    console.log(`Got error in conformity REST request: ${err}`);
  }

  conformityResp.send(JSON.stringify(conformityObject));
});

webClient.get('/fullConformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
  let conformityObject = confChecker.initializeValidityObject();
  const fullResourceList = ['health', 'data', 'mam', 'profile', 'metadata', 'config', 'event', 'license', 'rtLicense', 'licenseText'];
  try {
    conformityObject = await confChecker.checkConformity(conformityReq.params.originator, conformityReq.params.oi4Id, fullResourceList);
  } catch (err) {
    console.log(`Got error in conformity REST request: ${err}`);
  }

  conformityResp.send(JSON.stringify(conformityObject));
});
