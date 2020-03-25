import { OI4MessageBusProxy } from './Service/Proxy/Messagebus/index';
import { OI4WebProxy } from './Service/Proxy/Web/index';
import { ContainerState } from './Service/Container/index';
import { ESubResource } from './Service/Models/IContainer';
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
const logger = new Logger(true, 'Registry-Entrypoint', ESubResource.warn, busProxy.mqttClient, busProxy.appId, busProxy.serviceType);
logger.level = ESubResource.fatal;
logger.log(`Testprint for level ${ESubResource.trace}`, ESubResource.trace);
logger.log(`Testprint for level ${ESubResource.debug}`, ESubResource.debug);
logger.log(`Testprint for level ${ESubResource.info}`, ESubResource.info);
logger.log(`Testprint for level ${ESubResource.warn}`, ESubResource.warn);
logger.log(`Testprint for level ${ESubResource.error}`, ESubResource.error);
logger.log(`Testprint for level ${ESubResource.fatal}`, ESubResource.fatal);
logger.level = ESubResource.info;

// -------- Registry Application
import { Registry } from './Application/Registry';
import { IConformity } from './Application/Models/IConformityValidator';
import { ConformityValidator } from './Application/ConformityValidator';
const registry = new Registry(busProxy.mqttClient, contState.appId);

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

// --- WEBCLIENT: Take exposed webClient from webProxy and add custom routes ----
const webClient = webProxy.webClient;

webClient.get('/registry/application', (deviceReq, deviceResp) => {
  const filteredApps = JSON.parse(JSON.stringify(registry.applications));
  if (!registry.getConfig().showRegistry) {
    delete filteredApps[registry.getAppId()];
  }
  deviceResp.send(JSON.stringify(filteredApps));
});

webClient.get('/registry/device', (deviceReq, deviceResp) => {
  deviceResp.send(JSON.stringify(registry.devices));
});

webClient.delete('/registry/assets/:oi4Id', async (deviceReq, deviceResp) => {
  const oi4Id = deviceReq.params.oi4Id;
  console.log(`Trying to remove asset with Id: ${oi4Id}`);
  try {
    await registry.removeDevice(oi4Id);
  } catch (e) {
    console.log(e);
    deviceResp.sendStatus(404);
  }
  deviceResp.sendStatus(200);
});

webClient.delete('/registry/assets', async (deviceReq, deviceResp) => {
  try {
    await registry.clearRegistry();
  } catch (e) {
    console.log(e);
  }
  deviceResp.send('OK, cleared Registry');
});

webClient.delete('/registry/logs', async (deviceReq, deviceResp) => {
  let deletedFiles;
  try {
    deletedFiles = await registry.deleteFiles();
  } catch (e) {
    console.log(e);
  }
  deviceResp.send(`OK, deleted files: ${deletedFiles}`);
});

webClient.get('/registry/config', async (confReq, confResp) => {
  confResp.send(JSON.stringify(registry.getConfig()));
});

webClient.put('/registry/config', async (confReq, confResp) => {
  try {
    await registry.updateConfig(confReq.body);
  } catch (e) {
    console.log(e);
  }
  confResp.send(`OK, updated Registry Config with ${JSON.stringify(confReq.body)}`);
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

// -------- Conformity Checker Application (Used to be ConformityValidator instance, now we use the Registry)
webClient.get('/conformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
  let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
  try {
    conformityObject = await registry.updateConformityInDevice(conformityReq.params.oi4Id, []);
  } catch (err) {
    console.log(`Got error in conformity REST request: ${err}`);
  }

  conformityResp.send(JSON.stringify(conformityObject));
});

webClient.get('/fullConformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
  let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
  const fullResourceList = ['health', 'data', 'mam', 'profile', 'metadata', 'config', 'event', 'license', 'rtLicense', 'licenseText'];
  try {
    conformityObject = await registry.updateConformityInDevice(conformityReq.params.oi4Id, fullResourceList);
  } catch (err) {
    console.log(`Got error in conformity REST request: ${err}`);
  }

  conformityResp.send(JSON.stringify(conformityObject));
});
