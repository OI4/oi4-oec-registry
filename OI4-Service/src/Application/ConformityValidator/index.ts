import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { EventEmitter } from 'events';
import { IConformity, EValidity } from '../Models/IConformityValidator';
const { promiseTimeout } = require('../../Service/Utilities/Timeout/index');
import { OPCUABuilder } from '../../Service/Utilities/OPCUABuilder/index';

import NetworkMessageSchemaJson = require('./Schemas/NetworkMessage.schema.json');
import MetaDataVersionSchemaJson = require('./Schemas/MetaDataVersion.schema.json');
import oi4IdentifierSchemaJson = require('./Schemas/oi4Identifier.schema.json');
import DataSetMessageSchemaJson = require('./Schemas/DataSetMessage.schema.json');
import descriptionSchemaJson = require('./Schemas/description.schema.json');

// Payloads
import healthSchemaJson = require('./Schemas/health.schema.json');
import mamSchemaJson = require('./Schemas/mam.schema.json');
import licenseSchemaJson = require('./Schemas/license.schema.json');
import licenseTextSchemaJson = require('./Schemas/licenseText.schema.json');
import profileSchemaJson = require('./Schemas/profile.schema.json');
import eventSchemaJson = require('./Schemas/event.schema.json');
import rtLicenseSchemaJson = require('./Schemas/rtLicense.schema.json');
import configSchemaJson = require('./Schemas/config.schema.json');

import Ajv from 'ajv'; /*tslint:disable-line*/
import { Logger } from '../../Service/Utilities/Logger';

interface TMqttOpts {
  clientId: string;
  servers: object[];
  will?: object;
}

interface IResultObject {
  eRes: EValidity;
  payload: any;
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
  private readonly logger: Logger;
  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.builder = new OPCUABuilder('appId'); // TODO: Set appId to something useful
    const serverObj = {
      host: process.env.OI4_ADDR as string,
      port: parseInt(process.env.OI4_PORT as string, 10),
    };

    const mqttOpts: TMqttOpts = {
      clientId: `ConformityCheck${process.env.CONTAINERNAME as string}`,
      servers: [serverObj],
    };
    this.conformityClient = mqtt.connect(mqttOpts);

    this.jsonValidator = new Ajv();
    // Add Validation Schemas
    // First common Schemas
    this.jsonValidator.addSchema(NetworkMessageSchemaJson, 'NetworkMessage.schema.json');
    this.jsonValidator.addSchema(MetaDataVersionSchemaJson, 'MetaDataVersion.schema.json');
    this.jsonValidator.addSchema(oi4IdentifierSchemaJson, 'oi4Identifier.schema.json');
    this.jsonValidator.addSchema(DataSetMessageSchemaJson, 'DataSetMessage.schema.json');
    this.jsonValidator.addSchema(descriptionSchemaJson, 'description.schema.json');

    // Then payload Schemas
    this.jsonValidator.addSchema(healthSchemaJson, 'health.schema.json');
    this.jsonValidator.addSchema(mamSchemaJson, 'mam.schema.json');
    this.jsonValidator.addSchema(licenseSchemaJson, 'license.schema.json');
    this.jsonValidator.addSchema(licenseTextSchemaJson, 'licenseText.schema.json');
    this.jsonValidator.addSchema(profileSchemaJson, 'profile.schema.json');
    this.jsonValidator.addSchema(eventSchemaJson, 'event.schema.json');
    this.jsonValidator.addSchema(rtLicenseSchemaJson, 'rtLicense.schema.json');
    this.jsonValidator.addSchema(configSchemaJson, 'config.schema.json');
  }

  /**
   * A huge function with a simple purpose: Initialize a validity object with NOK values.
   * The validator functions set the individual tested methods to OK. Anything not set to OK remains in a failed state.
   */
  initializeValidityObject(): IConformity {
    const validityObject: IConformity = {
      oi4Id: EValidity.default,
      validity: EValidity.default,
      resource: {},
      checkedResourceList: [],
      profileResourceList: [],
      nonProfileResourceList: [],
    };
    return validityObject;
  }

  /**
   * Check conformity of every resource in the variable resourceList.
   * If a resource passes, its entry in the conformity Object is set to 'OK', otherwise, the initialized 'NOK' values persist.
   * @param fullTopic - the entire topic used to check conformity. Used to extract oi4Id and other values FORMAT:
   */
  async checkConformity(fullTopic: string, resourceList?: string[]) {
    const mandatoryResourceList = ['mam', 'health', 'license', 'licenseText', 'profile'];
    const topicArray = fullTopic.split('/');
    const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
    const conformityObject = this.initializeValidityObject();
    let errorSoFar = false;
    const licenseList: string[] = [];
    let oi4Result;
    let resObj;
    try {
      oi4Result = await ConformityValidator.checkOI4IDConformity(oi4Id);
    } catch (err) {
      this.logger.log(`ConformityValidator: Error in checkOI4IDConformity: ${err}`, 'w', 2);
      return conformityObject;
    }
    if (oi4Result) {
      conformityObject.oi4Id = EValidity.ok;
      const profileRes = await this.checkResourceConformity(fullTopic, oi4Id, 'profile') as IResultObject;
      if (profileRes.eRes === EValidity.ok) {
        conformityObject.profileResourceList = profileRes.payload.resource;
        console.log(mandatoryResourceList);
        console.log(conformityObject.profileResourceList);
        if (mandatoryResourceList.every(i => conformityObject.profileResourceList.includes(i))) {
          console.log('Hello');
          conformityObject.resource['profile'] = {
            validity: EValidity.ok,
          };
        } else {
          conformityObject.resource['profile'] = {
            validity: EValidity.partial,
            validityError: 'Profile does not contain Mandatory Resoruces',
          };
        }
      }
      // First, all mandatories
      const checkedList: string[] = mandatoryResourceList;
      // Second, all profile-Resources
      for (const resources of conformityObject.profileResourceList) {
        if (!(checkedList.includes(resources))) {
          checkedList.push(resources);
        }
      }
      // This, all non-profile-non-mandatory resources
      if (resourceList) {
        console.log(`Got ResourceList from Param: ${resourceList}`);
        for (const resources of resourceList) {
          if (!(checkedList.includes(resources))) {
            checkedList.push(resources);
            conformityObject.nonProfileResourceList.push(resources);
          }
        }
      }

      conformityObject.checkedResourceList = checkedList;

      for (const resource of checkedList) {
        let validity: EValidity = EValidity.nok;
        try {
          if (resource === 'profile') continue;
          if (resource === 'license') { // License is a different case. We actually need to parse the return value here
            resObj = await this.checkResourceConformity(fullTopic, oi4Id, resource) as IResultObject;
            validity = resObj.eRes;
            const licPayload = resObj.payload;
            for (const licenses of licPayload.licenses) { // With the obtained licenses, we can check the licenseText resource per TC-T6
              licenseList.push(licenses.licenseId);
            }
          } else if (resource === 'licenseText') {
            for (const licenses of licenseList) {
              resObj = await this.checkResourceConformity(fullTopic, licenses, resource) as IResultObject; // here, the oi4ID is the license
              validity = resObj.eRes;
            }
          } else {
            resObj = await this.checkResourceConformity(fullTopic, oi4Id, resource) as IResultObject;
            validity = resObj.eRes;
          }
          if (validity === EValidity.ok) { // Set the validity according to the results
            conformityObject.resource[resource] = {
              validity: EValidity.ok,
            };
          } else if (validity === EValidity.partial) {
            conformityObject.resource[resource] = {
              validity: EValidity.partial,
            };
          }
        } catch (err) {
          this.logger.log(`ConformityValidator: ${resource} did not pass with ${err}`, 'w', 2);
          conformityObject.resource[resource] = {
            validity: EValidity.nok,
          };
          if (resource === 'data' || resource === 'metadata' || resource === 'event') {
            conformityObject.resource[resource] = {
              validity: EValidity.default,
            };
          }
          if (this.mandatoryResource.includes(resource)) { // If it's not mandatory, we do not count the error!
            errorSoFar = true;
            // No response means NOK
          }
        }
      }
      if (errorSoFar) { // If we had any error so far, the entire validity is at least "partial"
        conformityObject.validity = EValidity.partial;
      } else {
        conformityObject.validity = EValidity.ok;
      }
    }
    console.log(`Final conformity object: ${JSON.stringify(conformityObject)}`);
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
  async checkResourceConformity(fullTopic: string, tag: string, resource: string, orig) {
    const conformityPayload = this.builder.buildOPCUADataMessage('{}', new Date, `${resource}Conformity`);
    this.conformityClient.once('message', async (topic, rawMsg) => {
      await this.conformityClient.unsubscribe(`${fullTopic}/pub/${resource}/${tag}`);
      if (topic === `${fullTopic}/pub/${resource}/${tag}`) {
        const parsedMessage = JSON.parse(rawMsg.toString());
        let eRes = 0;
        let networkMessageValidationResult;
        let payloadValidationResult;
        if (resource === 'rtLicense' || resource === 'config') {
          console.log();
        }
        try {
          networkMessageValidationResult = await this.jsonValidator.validate('NetworkMessage.schema.json', parsedMessage);
        } catch (validateErr) {
          this.logger.log(validateErr);
          networkMessageValidationResult = false;
        }
        try {
          payloadValidationResult = await this.jsonValidator.validate(`${resource}.schema.json`, parsedMessage.Messages[0].Payload);
        } catch (validateErr) {
          this.logger.log(validateErr);
          payloadValidationResult = false;
        }
        if (networkMessageValidationResult && payloadValidationResult) {
          if (parsedMessage.CorrelationId === conformityPayload.MessageId) {
            eRes = EValidity.ok;
          } else {
            eRes = EValidity.partial;
            this.logger.log(`ConformityValidator: CorrelationID did not pass for ${tag} with resource ${resource}`);
          }
        } else {
          this.logger.log(this.jsonValidator.errorsText());
          eRes = EValidity.partial;
        }
        const resObj: IResultObject = {
          eRes,
          payload: parsedMessage.Messages[0].Payload,
        };
        this.emit(`${resource}${fullTopic}Success`, resObj); // God knows how many hours I wasted here! We send the OI4ID with the success emit
        // This way, ONLY the corresponding Conformity gets updated!
      }
    });
    await this.conformityClient.subscribe(`${fullTopic}/pub/${resource}/${tag}`);
    await this.conformityClient.publish(`${fullTopic}/get/${resource}/${tag}`, JSON.stringify(conformityPayload));
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
      const serviceTypes = ['Registry', 'OTConnector', 'Utility', 'Persistence', 'Aggregation', 'OOCConnector'];
      if (!(serviceTypes.includes(topicArray[1]))) return false; // throw new Error('Unknown ServiceType');
      const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
      return await ConformityValidator.checkOI4IDConformity(oi4Id);
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
