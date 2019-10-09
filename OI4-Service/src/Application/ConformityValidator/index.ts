import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { IOPCUAData, IOPCUAMetaData } from '../../Service/Models/IOPCUAPayload';
import { EventEmitter } from 'events';
import { IConformity, EValidity } from '../Models/IConformityValidator';
const { promiseTimeout } = require('../../Service/Utilities/Timeout/index');
import { OPCUABuilder } from '../../Service/Utilities/OPCUABuilder/index';
import os from 'os';

import networkMessageSchemaJson = require('./Schemas/network-message.schema.json');
import metadataVersionSchemaJson = require('./Schemas/metadata-version.schema.json');
import oi4IdentifierSchemaJson = require('./Schemas/oi4-identifier.schema.json');
import healthPayloadSchemaJson = require('./Schemas/health-payload.schema.json');
import masterAssetModelPayloadSchemaJson = require('./Schemas/master-asset-model-payload.schema.json');
import dataSetMessageSchemaJson = require('./Schemas/data-set-message.schema.json');
import descriptionSchemaJson = require('./Schemas/description.schema.json');
import licensePayloadSchemaJson = require('./Schemas/license-payload.schema.json');
import licenseTextPayloadSchemaJson = require('./Schemas/license-text-payload.schema.json');
import profilePayloadSchemaJson = require('./Schemas/profile-payload.schema.json');

import Ajv from 'ajv'; /*tslint:disable-line*/

interface TMqttOpts {
  clientId: string;
  servers: object[];
  will?: object;
}

/**
 * Responsible for checking mandatory OI4-conformance.
 * Only checks for response within a certain amount of time, not for 100% payload conformity.
 * TODO: Improve JSON Schema checks!
 */
export class ConformityValidator extends EventEmitter {
  private conformityClient: mqtt.AsyncClient;
  private readonly serviceTypes = ['Registry', 'OTConnector', 'Utility', 'Persistence', 'Aggregation', 'OOCConnector'];
  private readonly mandatoryResource = ['health', 'license', 'licenseText', 'mam', 'profile'];
  private builder: OPCUABuilder;
  private readonly jsonValidator: Ajv.Ajv;
  constructor() {
    super();
    this.builder = new OPCUABuilder('appId'); // TODO: Set appId to something useful
    const serverObj = {
      host: process.env.OI4_ADDR as string,
      port: parseInt(process.env.OI4_PORT as string, 10),
    };

    const mqttOpts: TMqttOpts = {
      clientId: `ConformityCheck${os.hostname()}`,
      servers: [serverObj],
    };
    this.conformityClient = mqtt.connect(mqttOpts);

    this.jsonValidator = new Ajv();
    // Add Validation Schemas
    this.jsonValidator.addSchema(networkMessageSchemaJson, 'network-message.schema.json');
    this.jsonValidator.addSchema(metadataVersionSchemaJson, 'metadata-version.schema.json');
    this.jsonValidator.addSchema(oi4IdentifierSchemaJson, 'oi4-identifier.schema.json');
    this.jsonValidator.addSchema(healthPayloadSchemaJson, 'health-payload.schema.json');
    this.jsonValidator.addSchema(masterAssetModelPayloadSchemaJson, 'master-asset-model-payload.schema.json');
    this.jsonValidator.addSchema(dataSetMessageSchemaJson, 'data-set-message.schema.json');
    this.jsonValidator.addSchema(descriptionSchemaJson, 'description.schema.json');
    this.jsonValidator.addSchema(licensePayloadSchemaJson, 'license-payload.schema.json');
    this.jsonValidator.addSchema(licenseTextPayloadSchemaJson, 'license-text-payload.schema.json');
    this.jsonValidator.addSchema(profilePayloadSchemaJson, 'profile-payload.schema.json');
  }

  /**
   * A huge function with a simple purpose: Initialize a validity object with NOK values.
   * The validator functions set the individual tested methods to OK. Anything not set to OK remains in a failed state.
   */
  initializeValidityObject(): IConformity {
    const validityObject: IConformity = {
      oi4Id: EValidity.nok,
      validity: EValidity.nok,
      resource: {
        license: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        licenseText: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        rtLicense: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        data: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        mam: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        config: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        health: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
        profile: {
          validity: EValidity.nok,
          method: {
            pub: EValidity.nok,
            get: EValidity.nok,
          },
        },
      },
    };
    return validityObject;
  }

  /**
   * Check conformity of every resource in the variable resourceList.
   * If a resource passes, its entry in the conformity Object is set to 'OK', otherwise, the initialized 'NOK' values persist.
   * @param fullTopic - the entire topic used to check conformity. Used to extract oi4Id and other values FORMAT:
   */
  async checkConformity(fullTopic: string) {
    const topicArray = fullTopic.split('/');
    const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
    const conformityObject = this.initializeValidityObject();
    let errorSoFar = false;
    const resourceList = ['health', 'license', 'licenseText', 'rtLicense', 'config', 'mam', 'data', 'profile'];
    const licenseList: string[] = [];
    let oi4Result;
    try {
      oi4Result = await ConformityValidator.checkOI4IDConformity(oi4Id);
    } catch (err) {
      console.log(`ConfValid: Error in checkOI4IDConformity: ${err}`);
      return conformityObject;
    }
    if (oi4Result) {
      conformityObject.oi4Id = EValidity.ok;
      for (const resource of resourceList) {
        let validity: EValidity = EValidity.nok;
        try {
          if (resource === 'license') { // License is a different case. We actually need to parse the return value here
            const resObj = await this.checkResourceConformity(fullTopic, oi4Id, resource);
            validity = resObj.eRes;
            const licPayload = resObj.payload;
            for (const licenses of licPayload.licenses) { // With the obtained licenses, we can check the licenseText resource per TC-T6
              licenseList.push(licenses.licenseId);
            }
          } else if (resource === 'licenseText') {
            for (const licenses of licenseList) {
              validity = await this.checkResourceConformity(fullTopic, licenses, resource); // here, the oi4ID is the license
            }
          } else {
            validity = await this.checkResourceConformity(fullTopic, oi4Id, resource);
          }

          if (validity === EValidity.ok) { // Set the validity according to the results
            conformityObject.resource[resource].method.get = EValidity.ok;
            conformityObject.resource[resource].method.pub = EValidity.ok;
            conformityObject.resource[resource].validity = EValidity.ok;
          } else if (validity === EValidity.partial) {
            conformityObject.resource[resource].method.get = EValidity.partial;
            conformityObject.resource[resource].method.pub = EValidity.partial;
            conformityObject.resource[resource].validity = EValidity.partial;
          }

        } catch (err) {
          console.log(`ConfValid: ${resource} did not pass with ${err}`);
          if (this.mandatoryResource.includes(resource)) { // If it's not mandatory, we do not count the error!
            errorSoFar = true;
          }
        }
      }
      if (errorSoFar) { // If we had any error so far, the entire validity is at least "partial"
        conformityObject.validity = EValidity.partial;
      } else {
        conformityObject.validity = EValidity.ok;
      }
    }
    return conformityObject;
  }

  /**
   * Checks the conformity of a resource of an OI4-participant by publishing a /get/<resource> on the bus and expecting a response
   * within a certain timeframe. The response is then superficially checked for validity (mostly NetworkMessage structure) and for correlationID functionality.
   * (Rev06 states that the MessageID of a requestor is to be written to the correlationID of the answer).
   * If everything matches, an 'OK' response is returned.
   * If we receive an answer, but the payload / correlation ID is not conform, a 'Partial' response is returned.
   * If we don't receive an answer within the given timeframe, an error is returned.
   * @param fullTopic - the oi4-topic of the requestor
   * @param oi4Id - the oi4Id of the requestor
   * @param resource - the resource that is to be checked (health, license, etc...)
   */
  private async checkResourceConformity(fullTopic: string, oi4Id: string, resource: string) {
    const conformityPayload = this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`);
    this.conformityClient.once('message', async (topic, rawMsg) => {
      await this.conformityClient.unsubscribe(`${fullTopic}/pub/${resource}/${oi4Id}`);
      if (topic === `${fullTopic}/pub/${resource}/${oi4Id}`) {
        const parsedMessage = JSON.parse(rawMsg.toString());
        let eRes = 0;
        let altValidationResult;
        try {
          altValidationResult = await this.jsonValidator.validate('network-message.schema.json', parsedMessage);
        } catch (validateErr) {
          console.log(validateErr);
          altValidationResult = false;
        }
        if (altValidationResult) {
          eRes = EValidity.ok;
          if (parsedMessage.CorrelationId === conformityPayload.MessageId) {
            eRes = EValidity.ok;
          } else {
            eRes = EValidity.nok;
            console.log(`CorrelationID not passed for ${oi4Id} with resource ${resource}`);
          }
        } else {
          console.log(this.jsonValidator.errorsText());
          eRes = EValidity.partial;
        }
        if (resource === 'license') { // FIXME: Fix this hardcoded stuff...
          const licRes = {
            eRes,
            payload: parsedMessage.Messages[0].Payload,
          };
          this.emit(`${resource}${fullTopic}Success`, licRes);
        } else {
          this.emit(`${resource}${fullTopic}Success`, eRes); // God knows how many hours I wasted here! We send the OI4ID with the success emit
        }
        // This way, ONLY the corresponding Conformity gets updated!
      }
    });
    await this.conformityClient.subscribe(`${fullTopic}/pub/${resource}/${oi4Id}`);
    await this.conformityClient.publish(`${fullTopic}/get/${resource}/${oi4Id}`, JSON.stringify(conformityPayload));
    return await promiseTimeout(new Promise((resolve, reject) => {
      this.once(`${resource}${fullTopic}Success`, (res) => {
        resolve(res);
      });
    }),
      400, /*tslint:disable-line*/ // 400ms as the timeout
      `${resource}Error`, /*tslint:disable-line*/
    );

  }

  /**
   * Checks the full topic (including oi4/... preamble) for conformity.
   * @param topic - the full topic that is checked
   */
  static async checkTopicConformity(topic: string) {
    const topicArray = topic.split('/');
    if (topicArray.length >= 8) {
      let oi4String = '';
      for (let i = 0; i < 6; i = i + 1) {
        oi4String = `${oi4String}/${topicArray[i]}`;
      }
      const checkedString = oi4String.slice(1);
      const serviceTypes = ['Registry', 'OTConnector', 'Utility', 'Persistence', 'Aggregation', 'OOCConnector'];
      if (!(serviceTypes.includes(topicArray[1]))) return false; // throw new Error('Unknown ServiceType');
      const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
      if (await ConformityValidator.checkOI4IDConformity(oi4Id)) { // TODO: change from static to class method
        // if (oi4Array[0] !== 'OI4') return false; // throw new Error('Must lead with OI4');
        // if (!(serviceTypes.includes(oi4Array[1]))) return false; // throw new Error('Unknown ServiceType');
        return true; // TODO: Validate method and resource from lookup-list
      } else { /*tslint:disable-line*/ // We need to explicitly return false here!
        return false; // A bit verbose, but if the OI4 ID is not conform, the whole topic is not conform aswell
      }
    } else { /*tslint:disable-line*/
      return false; // For minimum validity, we need oi4ID (length: 6) + method + method
    }
  }

  static async checkOI4IDConformity(oi4Id: string) {
    const oi4Array = oi4Id.split('/');
    if (oi4Array.length !== 4) return false; // throw new Error('Wrong number of subTopics');
    // further checks will follow!
    return true;
  }
}
