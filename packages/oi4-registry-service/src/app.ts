import {OI4ApplicationFactory} from '@oi4/oi4-oec-service-node';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';
import {RegistryWebClient } from './Application/WebClient/RegistryWebClient';
import {Swagger} from './Application/WebClient/Swagger';
import {RegistryResources} from './Application/RegistryResources';

// @ts-ignore
import pJson from '../package.json';
import dotenv from 'dotenv';
import path from 'path';
// -------- Registry Application
import {Registry} from './Application/Registry/Registry';
import {StartupConfig} from './Application/StartupConfig';


const startupConfig = new StartupConfig();
const applicationResources = new RegistryResources();
const applicationFactory = new OI4ApplicationFactory(applicationResources);
const registryApp = applicationFactory.createOI4Application();
const port = startupConfig.edgeApplicationPort;
const registry = new Registry(registryApp.mqttClient, applicationResources);
const webProxy = new RegistryWebClient(registryApp, registry, port);

const logLevel = startupConfig.logLevel;
const publishingLevel = startupConfig.publishingLevel;
const logger = new Logger(true, 'Registry-Entrypoint', logLevel, publishingLevel, registryApp.mqttClient, registryApp.oi4Id, registryApp.serviceType);
logger.level = ESyslogEventFilter.debug;
logger.log(`Testprint for level ${ESyslogEventFilter.debug}`, ESyslogEventFilter.debug);
logger.log(`Testprint for level ${ESyslogEventFilter.informational}`, ESyslogEventFilter.informational);
logger.log(`Testprint for level ${ESyslogEventFilter.notice}`, ESyslogEventFilter.notice);
logger.log(`Testprint for level ${ESyslogEventFilter.warning}`, ESyslogEventFilter.warning);
logger.log(`Testprint for level ${ESyslogEventFilter.error}`, ESyslogEventFilter.error);
logger.log(`Testprint for level ${ESyslogEventFilter.critical}`, ESyslogEventFilter.critical);
logger.log(`Testprint for level ${ESyslogEventFilter.alert}`, ESyslogEventFilter.alert);
logger.log(`Testprint for level ${ESyslogEventFilter.emergency}`, ESyslogEventFilter.emergency);
logger.level = ESyslogEventFilter.warning;


if (startupConfig.useOpenAPI)
{
    const swagger = new Swagger(webProxy.webClient);
    swagger.initSwagger();
}