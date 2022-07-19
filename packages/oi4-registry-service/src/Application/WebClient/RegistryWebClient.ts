import mqtt = require('async-mqtt');
import {Oi4WebClient} from './Oi4WebClient';
import {Registry} from '../Registry/Registry';
import {MqttSettings, OI4Application} from '@oi4/oi4-oec-service-node';
import {Application} from '@oi4/oi4-oec-service-model';
import {ConformityValidator, IConformity} from '@oi4/oi4-oec-service-conformity-validator';
import { RegistryResources } from '../RegistryResources';

export class RegistryWebClient extends Oi4WebClient {

    private readonly _registry: Registry;
    private readonly _applicationResources: RegistryResources;

    constructor(application: OI4Application, registry: Registry, port = 5799)
    {
        super(application, port);
        this._registry = registry;
        this._applicationResources = application.applicationResources as RegistryResources;

        this.client.get('/brokerState', (_brokerReq, brokerResp) => {

            brokerResp.send(application.mqttClient.connected);
        });

        this.client.get('/mqttSettings', (mqttSettingsReq, mqttSettingsResp) => {
            // workaround for bug in the async-mqtt library
            // 'mqttClient.options' returns undefined / must use 'mqttClient._client.options' instead
            const clientOpts: mqtt.IClientOptions = (application.mqttClient as any)._client.options;

            mqttSettingsResp.send(JSON.stringify({
                brokerUri: `${clientOpts.protocol}://${clientOpts.host}:${clientOpts.port}`,
                mqttVersion: `MQTT ${this.protocolVersionToString(clientOpts.protocolVersion!)}`,
                userName: clientOpts.username?.split('').map((letter: any) => '*').join(''),
                password: clientOpts.password?.split('').map((letter: any) => '*').join(''),
                keepAlive: `${clientOpts.keepalive} seconds`,
                connectTimeout:  clientOpts.connectTimeout ===  undefined ? '' : `${clientOpts.connectTimeout / 1000} second(s)`,
                cleanSession: clientOpts.clean === undefined ? '' : clientOpts.clean.toString(),
                validateCertificate: this.isTlsEnabled(clientOpts)
            }));
        });


        this.client.get('/registry/application', (deviceReq, deviceResp) => {
            const filteredApps = JSON.parse(JSON.stringify(registry.applications));
            if (!this._applicationResources.settings.registry.showRegistry) {
                delete filteredApps[registry.getOi4Id()];
            }
            deviceResp.send(JSON.stringify(filteredApps));
        });
        
        this.client.get('/registry/device', (deviceReq, deviceResp) => {
            deviceResp.send(JSON.stringify(registry.devices));
        });
        
        this.client.delete('/registry/assets/:oi4Id', async (deviceReq, deviceResp) => {
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
        
        this.client.delete('/registry/assets', async (deviceReq, deviceResp) => {
            try {
                await registry.clearRegistry();
            } catch (e) {
                console.log(e);
            }
            deviceResp.send('OK, cleared Registry');
        });
        
        this.client.delete('/registry/logs', async (deviceReq, deviceResp) => {
            let deletedFiles;
            try {
                deletedFiles = await registry.deleteFiles();
            } catch (e) {
                console.log(e);
            }
            deviceResp.send(`OK, deleted files: ${deletedFiles}`);
        });
        
        this.client.get('/registry/config', async (confReq, confResp) => {
            confResp.send(JSON.stringify(this.applicationResources.config));
        });
        
        this.client.put('/registry/config', async (confReq, confResp) => {
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
            this.client.get(`/registry/${resources}/:oi4Id`, async (resourceReq, resourceResp) => {
                let resourceObject;
                try {
                    resourceObject = await registry.getResourceFromLookup(resourceReq.params.oi4Id, resources);
                    if (resourceObject === null || resourceObject === undefined) {
                        this.logger.log(`Resource not found in /registry/resources/:oi4Id ${resources}`);
                    }
                } catch (getResourceErr) {
                    resourceObject = getResourceErr;
                }
                resourceResp.send(JSON.stringify(resourceObject));
            });
        }
        
        this.client.get('/registry/event/:noOfElements', (deviceEventReq, deviceEventResp) => {
            const noOfElements = deviceEventReq.params.noOfElements;
            deviceEventResp.send(JSON.stringify(registry.getEventTrail(parseInt(noOfElements, 10))));
        });
        
        // -------- Conformity Checker Application (Used to be ConformityValidator instance, now we use the Registry)
        this.client.get('/conformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
            let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
            try {
                conformityObject = await registry.updateConformityInDevice(conformityReq.params.oi4Id, []);
            } catch (err) {
                console.log(`Got error in conformity REST request: ${err}`);
            }
        
            conformityResp.send(JSON.stringify(conformityObject));
        });
        
        this.client.get('/fullConformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
            let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
            try {
                conformityObject = await registry.updateConformityInDevice(conformityReq.params.oi4Id, Application.full);
            } catch (err) {
                console.log(`Got error in conformity REST request: ${err}`);
            }
        
            conformityResp.send(JSON.stringify(conformityObject));
        });
       
    }

    private protocolVersionToString(version?: number): string {
        if (version === 3) return '3';
        if (version === 4) return '3.1';
        if (version === 5) return '5';
        return 'unknown'
    }

    private isTlsEnabled(mqttSettings: MqttSettings): string {
        if (mqttSettings.rejectUnauthorized !== undefined)
        {
            return mqttSettings.rejectUnauthorized.toString();
        }

        return (mqttSettings.ca !== undefined &&
            mqttSettings.cert !== undefined &&
            mqttSettings.key !== undefined).toString();
    }
}