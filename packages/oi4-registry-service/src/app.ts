import {OI4ApplicationFactory} from '@oi4/oi4-oec-service-node';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';
import {RegistryWebClient} from './Application/WebClient/RegistryWebClient';
import {Swagger} from './Application/WebClient/Swagger';
import {RegistryResources} from './Application/RegistryResources';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pJson from '../package.json';
// -------- Registry Application
import {Registry} from './Application/Registry/Registry';
import {StartupConfig} from './Application/StartupConfig';


const startupConfig = new StartupConfig();
const applicationResources = new RegistryResources();
const applicationFactory = new OI4ApplicationFactory(applicationResources);
const registryApp = applicationFactory.createOI4Application();
const port = startupConfig.edgeApplicationPort;
const registry = new Registry(registryApp.messageBus.getClient(), applicationResources);
const webProxy = new RegistryWebClient(registryApp, registry, port, pJson.version, pJson.license);

const logLevel = startupConfig.logLevel;
const publishingLevel = startupConfig.publishingLevel;
const logger = new Logger(true, 'Registry-Entrypoint', logLevel, publishingLevel, registryApp.oi4Id, registryApp.serviceType, registryApp.messageBus.getClient());
logger.level = ESyslogEventFilter.debug;
logger.log(`Test print for level ${ESyslogEventFilter.debug}`, ESyslogEventFilter.debug);
logger.log(`Test print for level ${ESyslogEventFilter.informational}`, ESyslogEventFilter.informational);
logger.log(`Test print for level ${ESyslogEventFilter.notice}`, ESyslogEventFilter.notice);
logger.log(`Test print for level ${ESyslogEventFilter.warning}`, ESyslogEventFilter.warning);
logger.log(`Test print for level ${ESyslogEventFilter.error}`, ESyslogEventFilter.error);
logger.log(`Test print for level ${ESyslogEventFilter.critical}`, ESyslogEventFilter.critical);
logger.log(`Test print for level ${ESyslogEventFilter.alert}`, ESyslogEventFilter.alert);
logger.log(`Test print for level ${ESyslogEventFilter.emergency}`, ESyslogEventFilter.emergency);
logger.level = ESyslogEventFilter.warning;


if (startupConfig.useOpenAPI) {
    const swagger = new Swagger(webProxy.webClient);
    swagger.initSwagger();
}
