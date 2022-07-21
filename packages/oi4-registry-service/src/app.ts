import {OI4ApplicationFactory} from '@oi4/oi4-oec-service-node';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';
import { RegistryWebClient } from './Application/WebClient/RegistryWebClient';
import {RegistryResources} from './Application/RegistryResources';

// @ts-ignore
import pJson from '../package.json';
import dotenv from 'dotenv';
import path from 'path';
// -------- Registry Application
import {Registry} from './Application/Registry/Registry';

import express from 'express';

import swaggerUi from "swagger-ui-express";


// Here, we get our configuration from Environment variables. If either of them is not specified, we use a provided .env file
function checkForValidEnvironment() {
    return (!process.env.OI4_EDGE_MQTT_BROKER_ADDRESS ||
        !(process.env.OI4_EDGE_APPLICATION_INSTANCE_NAME) ||
        !(process.env.OI4_EDGE_MQTT_USERNAME) ||
        !(process.env.OI4_EDGE_MQTT_PASSWORD))
}

function checkForDefaultEnvironment() {
    if (!process.env.OI4_EDGE_EVENT_LEVEL) {
        console.log(`Init: EVENT_LEVEL not present, setting to default 'warning'`);
        process.env.OI4_EDGE_EVENT_LEVEL = 'warning';
    } else {
        if (!(process.env.OI4_EDGE_EVENT_LEVEL in ESyslogEventFilter)) {
            console.log(`Init: EVENT_LEVEL set to wrong value: ${process.env.OI4_EDGE_EVENT_LEVEL}, setting to default 'warning'`);
            process.env.OI4_EDGE_EVENT_LEVEL = 'warning';
        }
    }
    if (!process.env.OI4_EDGE_MQTT_SECURE_PORT) process.env.OI4_EDGE_MQTT_SECURE_PORT = '8883';
    if (!process.env.OI4_EDGE_MQTT_MAX_MESSAGE_SIZE) process.env.OI4_EDGE_MQTT_MAX_MESSAGE_SIZE = '262144';
}

/* --> TODO cfz remove environment variables (or use them for backward compatibility)

if (checkForValidEnvironment()) {
    dotenv.config({path: path.join(__dirname, '.env')});
    if (checkForValidEnvironment()) {
        console.log('Init: Failed to load default environment vars, stopping container');
        process.exit(1);
    }
}
checkForDefaultEnvironment();
<-- */


const applicationResources = new RegistryResources();
const applicationFactory = new OI4ApplicationFactory(applicationResources);
const registryApp = applicationFactory.createOI4Application();
const port = parseInt((process.env.OI4_EDGE_APPLICATION_PORT as string || '5799'), 10);
const registry = new Registry(registryApp.mqttClient, applicationResources);
const webProxy = new RegistryWebClient(registryApp, registry, port);

const logLevel: ESyslogEventFilter = process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter | ESyslogEventFilter.warning;
const publishingLevel = process.env.OI4_EDGE_EVENT_PUBLISHING_LEVEL ? process.env.OI4_EDGE_EVENT_PUBLISHING_LEVEL as ESyslogEventFilter : logLevel;
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


// Swagger specific -> 
const webClient = webProxy.webClient;

webClient.use(express.static('public'));
const options = {
    swaggerOptions: {
        url: "/api/openapi.json",
    },
    customCss: '.swagger-ui .topbar { display: none }'
};

webClient.use('/api', swaggerUi.serveFiles(null, options), swaggerUi.setup(null, options));

// <-- Swagger specific