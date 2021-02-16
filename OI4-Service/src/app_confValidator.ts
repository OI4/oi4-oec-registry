import { OI4MessageBusProxy } from './Service/src/Proxy/Messagebus/index';
import { OI4WebProxy } from './Service/src/Proxy/Web/index';
import { ContainerState } from './Service/src/Container/index';
import { ESubResource } from './Service/src/Models/IContainer';
import { Logger } from './Service/src/Utilities/Logger/index';
import dotenv from 'dotenv';
import path from 'path';

// Here, we get our configuration from Environment variables. If either of them is not specified, we use a provided .env file
if (!(process.env.MQTT_BROKER_ADDRESS) ||
  !(process.env.MQTT_PORT) ||
  !(process.env.APPLICATION_INSTANCE_NAME) ||
  !(process.env.USE_HTTPS) ||
  !(process.env.LOG_LEVEL)) {
  dotenv.config({ path: path.join(__dirname, '.env') });
  if (!(process.env.LOG_LEVEL) || !(process.env.LOG_LEVEL in ESubResource)) {
    console.log('Init: LOG_LEVEL either not specified or wrong enum value');
    process.env.LOG_LEVEL = 'warn';
  }
}

let selectedPort = 4567;
const portArg = process.argv[2];
if (typeof portArg !== 'undefined' && portArg !== null) {
  selectedPort = parseInt(portArg, 10);
}

const contState = new ContainerState();
const busProxy = new OI4MessageBusProxy(contState);
const webProxy = new OI4WebProxy(contState, selectedPort);
const logger = new Logger(true, 'Conformity-Validator-Entrypoint', process.env.LOG_LEVEL as ESubResource, busProxy.mqttClient, busProxy.oi4Id, busProxy.serviceType);
logger.level = ESubResource.fatal;
logger.log(`Testprint for level ${ESubResource.trace}`, ESubResource.trace);
logger.log(`Testprint for level ${ESubResource.debug}`, ESubResource.debug);
logger.log(`Testprint for level ${ESubResource.info}`, ESubResource.info);
logger.log(`Testprint for level ${ESubResource.warn}`, ESubResource.warn);
logger.log(`Testprint for level ${ESubResource.error}`, ESubResource.error);
logger.log(`Testprint for level ${ESubResource.fatal}`, ESubResource.fatal);
logger.level = ESubResource.info;

// -------- ConfValidator Application
import { IConformity } from './Application/Models/IConformityValidator';
import { ConformityValidator } from './Application/ConformityValidator';
const confValidator = new ConformityValidator(contState.oi4Id);

// --- WEBCLIENT: Take exposed webClient from webProxy and add custom routes ----
const webClient = webProxy.webClient;

// -------- Conformity Checker Application
webClient.get('/conformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
  let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
  try {
    conformityObject = await confValidator.checkConformity(conformityReq.params.originator, conformityReq.params.oi4Id, []);
  } catch (err) {
    console.log(`Got error in conformity REST request: ${err}`);
  }

  conformityResp.send(JSON.stringify(conformityObject));
});

webClient.get('/fullConformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
  let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
  const fullResourceList = ['health', 'data', 'mam', 'profile', 'metadata', 'config', 'event', 'license', 'rtLicense', 'licenseText'];
  try {
    conformityObject = await confValidator.checkConformity(conformityReq.params.originator, conformityReq.params.oi4Id, fullResourceList);
  } catch (err) {
    console.log(`Got error in conformity REST request: ${err}`);
  }

  conformityResp.send(JSON.stringify(conformityObject));
});
