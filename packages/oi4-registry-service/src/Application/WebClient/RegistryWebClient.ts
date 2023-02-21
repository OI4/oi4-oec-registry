import mqtt = require('async-mqtt');
import {Oi4WebClient} from './Oi4WebClient';
import {Registry} from '../Registry/Registry';
import {MqttSettings, IOI4Application} from '@oi4/oi4-oec-service-node';
import {Application, Oi4Identifier} from '@oi4/oi4-oec-service-model';
import {ConformityValidator, IConformity} from '@oi4/oi4-oec-service-conformity-validator';
import { RegistryResources } from '../RegistryResources';
import { IAsset } from '../Models/IRegistry';

export class RegistryWebClient extends Oi4WebClient {

    constructor(application: IOI4Application, registry: Registry, port = 5799, version: string, license: string)
    {
        super(application, port, version, license);

        this.client.get('/brokerState', (brokerReq, brokerResp) => {

            brokerResp.send(application.messageBus.getClient().connected);
        });

        this.client.get('/mqttSettings', (mqttSettingsReq, mqttSettingsResp) => {
            // workaround for bug in the async-mqtt library
            // 'mqttClient.options' returns undefined / must use 'mqttClient._client.options' instead
            const clientOpts: mqtt.IClientOptions = (application.messageBus.getClient() as any)._client.options;

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
            function include(asset: IAsset): boolean {
               return !asset.oi4Id.equals(registry.getOi4Id()) ||
                (application.applicationResources as RegistryResources).settings.registry.showRegistry;
            }

            const filteredApps = RegistryWebClient.convert(registry.applications.filter(a => include(a)));
            deviceResp.send(JSON.stringify(filteredApps));
        });

        this.client.get('/registry/device', (deviceReq, deviceResp) => {

            const devices = RegistryWebClient.convert(registry.devices);
            deviceResp.send(JSON.stringify(devices));
        });

        this.client.delete('/registry/assets/:oi4Id', async (deviceReq, deviceResp) => {
            const oi4Id = this.parseIdentifier(deviceReq.params.oi4Id);
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
        const resourceList = ['health', 'config', 'profile', 'license', 'rtLicense', 'licenseText', 'lastMessage', 'mam'];

        for (const resources of resourceList) {
            this.client.get(`/registry/${resources}/:oi4Id`, async (resourceReq, resourceResp) => {
                let resourceObject;
                try {
                    const oi4Id = this.parseIdentifier(resourceReq.params.oi4Id);
                    resourceObject = await registry.getResourceFromLookup(oi4Id, resources);
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
            const noOfElements = parseInt(deviceEventReq.params.noOfElements, 10);
            deviceEventResp.send(JSON.stringify(registry.getEventTrail(noOfElements)));
        });

        // -------- Conformity Checker Application (Used to be ConformityValidator instance, now we use the Registry)
        this.client.get('/conformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
            let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
            try {
                const oi4Id = this.parseIdentifier(conformityReq.params.oi4Id)
                conformityObject = await registry.updateConformityInDevice(oi4Id, []);
            } catch (err) {
                console.log(`Got error in conformity REST request: ${err}`);
            }

            conformityResp.send(JSON.stringify(conformityObject));
        });

        this.client.get('/fullConformity/:originator/:oi4Id', async (conformityReq, conformityResp) => {
            let conformityObject: IConformity = ConformityValidator.initializeValidityObject();
            try {
                const oi4Id = this.parseIdentifier(conformityReq.params.oi4Id);
                conformityObject = await registry.updateConformityInDevice(oi4Id, Application.full);
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

    private parseIdentifier(value: string): Oi4Identifier | undefined {
        try {
            return Oi4Identifier.fromString(value);

        } catch {
            return undefined;
        }
    }

    private static convert(assets: IAsset[]) {
        if (assets.length === 0) {
            return {};
        }

        return assets.map(a => { return { // convert oi4Identifier objects to its string representation
            ...a,
            oi4Id: a.oi4Id.toString(),
            oi4IdOriginator: a.oi4IdOriginator?.toString()
            }
        }).reduce((a, v) => ({...a, [v.oi4Id]: v }), {} ); // convert array to object list
    }
}
