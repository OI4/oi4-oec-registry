import {ContainerState, OI4MessageBusProxy, OI4WebProxy} from '@oi4/oi4-oec-service-node';
import {Logger} from '@oi4/oi4-oec-service-logger';
import {ESyslogEventFilter} from '@oi4/oi4-oec-service-model';
import {ConformityValidator, IConformity} from '@oi4/oi4-oec-service-conformity-validator';
import {IClientOptions} from 'async-mqtt';
import pjson from '../package.json';
import dotenv from 'dotenv';
import path from 'path';
// -------- Registry Application
import {Registry} from './Application/Registry';

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

if (checkForValidEnvironment()) {
    dotenv.config({path: path.join(__dirname, '.env')});
    if (checkForValidEnvironment()) {
        console.log('Init: Failed to load default environment vars, stopping container');
        process.exit(1);
    }
}
checkForDefaultEnvironment();


const contState = new ContainerState();
const busProxy = new OI4MessageBusProxy(contState);
const webProxy = new OI4WebProxy(contState);
const logger = new Logger(true, 'Registry-Entrypoint', process.env.OI4_EDGE_EVENT_LEVEL as ESyslogEventFilter, busProxy.mqttClient, busProxy.oi4Id, busProxy.serviceType);
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

// @ts-ignore: TODO: not assignable message...fix it
const registry = new Registry(busProxy.mqttClient, contState);

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

/**
 * This endpoint is used to retrieve specific container information for the cockpit plugin.
 * TODO: Move this to a standalone app executed in cockpit context, this has no place in the registry itself
 */
webClient.get('/containerInfo', (contInfoReq, contInfoResp) => {
    contInfoResp.send(JSON.stringify({
        name: contState.mam.Model.text,
        version: contState.mam.SoftwareRevision,
        description: contState.mam.Description.text,
        dependencies: ["mqtt-broker"],
        vendor: "Hilscher Gesellschaft f\u00fcr Systemautomation mbH",
        licensesCockpit: ["HILSCHER netIOT Source Code LICENSE AGREEMENT"],
        licensesOECRegistryCore: [pjson.license],
        disclaimer: "see https://www.netiot.com/fileadmin/user_upload/netIOT/en/pdf/Hilscher_Source_Code_License.pdf"
    }));
});

function protocolVersionToString(version: number) {
    if (version === 3) return '3';
    if (version === 4) return '3.1';
    if (version === 5) return '5';
    return 'unknown'
}

webClient.get('/mqttSettings', (mqttSettingsReq, mqttSettingsResp) => {
    // @ts-ignore: Client exists hidden TODO: This is dangerous!
    const clientOpts = busProxy.mqttClient._client.options as IClientOptions;
    mqttSettingsResp.send(JSON.stringify({
        brokerUri: `mqtts://${process.env.OI4_EDGE_MQTT_BROKER_ADDRESS}:${process.env.OI4_EDGE_MQTT_SECURE_PORT}`,
        mqttVersion: `MQTT ${protocolVersionToString(clientOpts.protocolVersion!)}`,
        userName: clientOpts.username?.split('').map((letter: any) => '*').join(''),
        password: clientOpts.password?.split('').map((letter: any) => '*').join(''),
        keepAlive: `${clientOpts.keepalive} seconds`,
        connectTimeout: '1 second',
        cleanSession: 'false',// clientOpts.clean!.toString(),
        validateCertificate: 'false',// clientOpts.rejectUnauthorized!.toString()
    }));
});


webClient.get('/registry/application', (deviceReq, deviceResp) => {
    const filteredApps = JSON.parse(JSON.stringify(registry.applications));
    if (!registry.getConfig().registry.showRegistry.value) {
        delete filteredApps[registry.getOi4Id()];
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

webClient.get('/registry/event/:noOfElements', (deviceEventReq, deviceEventResp) => {
    const noOfElements = deviceEventReq.params.noOfElements;
    deviceEventResp.send(JSON.stringify(registry.getEventTrail(parseInt(noOfElements, 10))));
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