import mqtt = require('async-mqtt'); /*tslint:disable-line*/
import { EventEmitter } from 'events';
import { IConformity, ISchemaConformity, EValidity, IValidityDetails } from '../Models/IConformityValidator';
const { promiseTimeout } = require('../../Service/Utilities/Timeout/index');
import { OPCUABuilder } from '../../Service/Utilities/OPCUABuilder/index';

import NetworkMessageSchemaJson = require('../../Config/Schemas/schemas/NetworkMessage.schema.json');
import MetaDataVersionSchemaJson = require('../../Config/Schemas/schemas/MetaDataVersion.schema.json');
import oi4IdentifierSchemaJson = require('../../Config/Schemas/schemas/oi4Identifier.schema.json');
import DataSetMessageSchemaJson = require('../../Config/Schemas/schemas/DataSetMessage.schema.json');
import LocalizedTextSchemaJson = require('../../Config/Schemas/schemas/LocalizedText.schema.json');
import resourcesSchemaJson = require('../../Config/Schemas/schemas/resources.schema.json');

// Payloads
import healthSchemaJson = require('../../Config/Schemas/schemas/health.schema.json');
import mamSchemaJson = require('../../Config/Schemas/schemas/mam.schema.json');
import licenseSchemaJson = require('../../Config/Schemas/schemas/license.schema.json');
import licenseTextSchemaJson = require('../../Config/Schemas/schemas/licenseText.schema.json');
import profileSchemaJson = require('../../Config/Schemas/schemas/profile.schema.json');
import eventSchemaJson = require('../../Config/Schemas/schemas/event.schema.json');
import rtLicenseSchemaJson = require('../../Config/Schemas/schemas/rtLicense.schema.json');
import configSchemaJson = require('../../Config/Schemas/schemas/config.schema.json');
import publicationListSchemaJson = require('../../Config/Schemas/schemas/publicationList.schema.json');
import subscriptionListSchemaJson = require('../../Config/Schemas/schemas/subscriptionList.schema.json');

// DSCIds
import { IDataSetClassIds, ESubResource } from '../../Service/Models/IContainer';
import dataSetClassIds = require('../../Config/Constants/dataSetClassIds.json'); /*tslint:disable-line*/
const dscids: IDataSetClassIds = <IDataSetClassIds>dataSetClassIds;

// Resource imports
import resourceLookup from '../../Config/Constants/resources.json'; /*tslint:disable-line*/

import Ajv from 'ajv'; /*tslint:disable-line*/
import { Logger } from '../../Service/Utilities/Logger';
import { IOPCUAData, IOPCUADataMessage } from '../../Service/Models/IOPCUAPayload';
import { EAssetType } from '../../Service/Enums/EContainer';

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
  static readonly serviceTypes = ['Registry', 'OTConnector', 'Utility', 'Persistence', 'Aggregation', 'OOCConnector'];
  private builder: OPCUABuilder;
  private readonly jsonValidator: Ajv.Ajv;
  private readonly logger: Logger;
  static completeProfileList: string[] = resourceLookup.full;
  constructor(oi4Id: string) {
    super();
    const serverObj = {
      host: process.env.MQTT_BROKER_ADDRESS as string,
      port: parseInt(process.env.MQTT_PORT as string, 10),
    };

    const mqttOpts: TMqttOpts = {
      clientId: `ConformityCheck${process.env.APPLICATION_INSTANCE_NAME as string}${oi4Id as string}`,
      servers: [serverObj],
    };
    this.conformityClient = mqtt.connect(mqttOpts);

    this.logger = new Logger(true, 'ConformityValidator-App', process.env.LOG_LEVEL as ESubResource, this.conformityClient, oi4Id, 'Utility');
    this.builder = new OPCUABuilder(oi4Id, 'Registry'); // TODO: Set oi4Id to something useful

    this.jsonValidator = new Ajv();
    // Add Validation Schemas
    // First common Schemas
    this.jsonValidator.addSchema(NetworkMessageSchemaJson, 'NetworkMessage.schema.json');
    this.jsonValidator.addSchema(MetaDataVersionSchemaJson, 'MetaDataVersion.schema.json');
    this.jsonValidator.addSchema(oi4IdentifierSchemaJson, 'oi4Identifier.schema.json');
    this.jsonValidator.addSchema(DataSetMessageSchemaJson, 'DataSetMessage.schema.json');
    this.jsonValidator.addSchema(LocalizedTextSchemaJson, 'LocalizedText.schema.json');
    this.jsonValidator.addSchema(resourcesSchemaJson, 'resources.schema.json');

    // Then payload Schemas
    this.jsonValidator.addSchema(healthSchemaJson, 'health.schema.json');
    this.jsonValidator.addSchema(mamSchemaJson, 'mam.schema.json');
    this.jsonValidator.addSchema(licenseSchemaJson, 'license.schema.json');
    this.jsonValidator.addSchema(licenseTextSchemaJson, 'licenseText.schema.json');
    this.jsonValidator.addSchema(profileSchemaJson, 'profile.schema.json');
    this.jsonValidator.addSchema(eventSchemaJson, 'event.schema.json');
    this.jsonValidator.addSchema(rtLicenseSchemaJson, 'rtLicense.schema.json');
    this.jsonValidator.addSchema(configSchemaJson, 'config.schema.json');
    this.jsonValidator.addSchema(publicationListSchemaJson, 'publicationList.schema.json');
    this.jsonValidator.addSchema(subscriptionListSchemaJson, 'subscriptionList.schema.json');
  }

  /**
   * A huge function with a simple purpose: Initialize a validity object with NOK values.
   * The validator functions set the individual tested methods to OK. Anything not set to OK remains in a failed state.
   */
  static initializeValidityObject(): IConformity {
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
  async checkConformity(fullTopic: string, oi4Id: string, resourceList?: string[]): Promise<IConformity> {
    const ignoredResources = ['data', 'metadata', 'event', 'config'];
    let assetType = EAssetType.application;
    const topicArray = fullTopic.split('/');
    const originator = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
    if (originator !== oi4Id) { // FIXME: This needs to be changed to a real detection or a function parameter.
      // Not every unequal originator/device combo has to be device - application pair...
      assetType = EAssetType.device;
    }

    const mandatoryResourceList = this.getMandatoryResources(assetType);
    this.logger.log(`MandatoryResourceList of tested Asset: ${mandatoryResourceList}`, ESubResource.info);

    const conformityObject = ConformityValidator.initializeValidityObject();
    let errorSoFar = false;
    const licenseList: string[] = [];
    let oi4Result;
    let resObj: IValidityDetails; // Container for validation results

    try {
      oi4Result = await ConformityValidator.checkOI4IDConformity(oi4Id);
    } catch (err) {
      this.logger.log(`OI4-ID of the tested asset does not match the specified format: ${err}`, ESubResource.error);
      return conformityObject;
    }

    if (!oi4Result) {
      this.logger.log('OI4-ID of the tested asset does not match the specified format', ESubResource.error);
      return conformityObject;
    }

    conformityObject.oi4Id = EValidity.ok; // If we got past the oi4Id check, we can continue with all resources.

    try {
      conformityObject.resource['profile'] = await this.checkProfileConformity(fullTopic, oi4Id, assetType);
    } catch (e) { // Profile did not return, we fill a dummy conformity entry so that we can continue checking the asset...
      conformityObject.resource['profile'] = {
        payload: {
          resource: [], // Timeout = no resources
        },
        validity: EValidity.nok,
        validityError: 'Timeout on Resource',
      };
    }

    // First, all mandatories
    const checkedList: string[] = JSON.parse(JSON.stringify(mandatoryResourceList));

    // Second, all resources actually stored in the profile (Only oi4-conform profile entries will be checked)
    for (const resources of conformityObject.resource.profile.payload.resource) {
      // The following lines are for checking whether there are some conform entries in the profile *additionally* to the mandatory ones
      if (!(checkedList.includes(resources))) { // Don't add resources twice
        if (ConformityValidator.completeProfileList.includes(resources)) { // Second condition is for checking if the profile event meets OI4-Standards
          checkedList.push(resources);
        } else { // If we find resource which are not part of the oi4 standard, we don't check them but we mark them as an error
          conformityObject.resource[resources] = {
            payload: {},
            validity: EValidity.nok,
            validityError: 'resource is unknown to oi4',
          };
        }
      }
    }

    // Third, if a resourceList is specified, add those to our resources to be checked
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

    resObj = { // ResObj Initialization before checking all Resources
      validity: EValidity.default,
      validityError: 'You should not see this in prod, initialization dummy obj',
      payload: {},
    };

    // Actually start checking the resources
    for (const resource of checkedList) {
      this.logger.log(`Checking Resource ${resource} (High-Level)`, ESubResource.info);
      try {
        if (resource === 'profile') continue; // We already checked profile
        if (resource === 'license') { // License is a different case. We actually need to parse the return value here
          resObj = await this.checkResourceConformity(fullTopic, oi4Id, resource) as IValidityDetails;
          const licPayload = resObj.payload;
          for (const licenses of licPayload.licenses) { // With the obtained licenses, we can check the licenseText resource per TC-T6
            licenseList.push(licenses.licenseId);
          }
        } else if (resource === 'licenseText') {
          for (const licenses of licenseList) {
            resObj = await this.checkResourceConformity(fullTopic, licenses, resource) as IValidityDetails; // here, the oi4ID is the license
          }
        } else {
          if (resource === 'publicationList' || resource === 'subscriptionList') {
            resObj = await this.checkResourceConformity(fullTopic, '', resource) as IValidityDetails;
          } else {
            resObj = await this.checkResourceConformity(fullTopic, oi4Id, resource) as IValidityDetails;
          }
        }
      } catch (err) {
        this.logger.log(`${resource} did not pass check with ${err}`, ESubResource.error);
        resObj = {
          validity: EValidity.nok,
          validityError: err,
          payload: {},
        };
        if (mandatoryResourceList.includes(resource)) { // If it's not mandatory, we do not count the error!
          errorSoFar = true;
          // No response means NOK
        }
      }

      if (resObj.validity === EValidity.ok || resObj.validity === EValidity.default) { // Set the validity according to the results
        conformityObject.resource[resource] = resObj;
      } else if (resObj.validity === EValidity.partial) {
        if (mandatoryResourceList.includes(resource)) { // TODO: This is a little strict, but we are strict for now
          errorSoFar = true;
        } else {
          if (ignoredResources.includes(resource)) {
            resObj.validity = EValidity.default;
            resObj.validityError = 'Resource result ignored';
            errorSoFar = false;
          }
        }
      }

      // Finally, assign the temporary ResObj to the conformityObject
      conformityObject.resource[resource] = {
        validity: resObj.validity,
        validityError: resObj.validityError,
        payload: resObj.payload,
      };
    }

    if (errorSoFar) { // If we had any error so far, the entire validity is at least "partial"
      conformityObject.validity = EValidity.partial;
    } else {
      conformityObject.validity = EValidity.ok;
    }

    this.logger.log(`Final conformity object: ${JSON.stringify(conformityObject)}`, ESubResource.debug);

    // Convert to old style:
    return conformityObject;
  }

  /**
   * Since the simple resource check does not check for additional logic, we implement those checks here
   * 1) The profile payload needs to contain the mandatory resources for its asset type
   * 2) The profile payload should not contain additional resources to the ones specified in the oi4 guideline
   * 3) Every resource that is specified in the profile payload needs to be accessible (exceptions for data, metadata, event)
   * Sidenote: "Custom" Resources will be marked as an error and not checked
   * @param fullTopic The fullTopic that is used to check the get-route
   * @param oi4Id  The oidId of the tested asset ("tag element")
   * @param assetType The type of asset being tested (device / application)
   * @returns {IValidityDetails} A validity object containing information about the conformity of the profile resource
   */

  async checkProfileConformity(fullTopic: string, oi4Id: string, assetType: EAssetType): Promise<IValidityDetails> {
    let resObj: IValidityDetails;

    try {
      resObj = await this.checkResourceConformity(fullTopic, oi4Id, 'profile');
    } catch (e) {
      this.logger.log(`Error in checkProfileConformity: ${e}`);
      throw e;
    }

    const profilePayload = resObj.payload;
    const mandatoryResourceList = this.getMandatoryResources(assetType);

    if (!(mandatoryResourceList.every(i => profilePayload.resource.includes(i)))) {
      resObj.validity = EValidity.partial;
      resObj.validityError = `${resObj.validityError} + Not every mandatory in resource list of profile`;
    }
    return resObj;
  }

  /**
   * Retrieves a list of resources which are considered mandatory according to assetType and
   * @param assetType The type that is used to retrieve the list of mandatory resources
   * @returns {string[]} A list of mandatory resources
   */
  getMandatoryResources(assetType: EAssetType): string[] {
    let mandatoryResources = [];
    if (assetType === EAssetType.application) {
      mandatoryResources = resourceLookup.application.mandatory;
    } else {
      mandatoryResources = resourceLookup.device.mandatory;
    }
    return mandatoryResources;
  }

  /**
   * Checks the conformity of a resource of an OI4-participant by publishing a /get/<resource> on the bus and expecting a response
   * within a certain timeframe. The response is then superficially checked for validity (mostly NetworkMessage structure) and for correlationID functionality.
   * (Rev06 states that the MessageID of a requestor is to be written to the correlationID of the answer).
   * If everything matches, an 'OK' response is returned.
   * If we receive an answer, but the payload / correlation ID is not conform, a 'Partial' response is returned.
   * If we don't receive an answer within the given timeframe, an error is returned.
   * @param fullTopic - the originator oi4Id of the requestor
   * @param tag - the tag of the requestor, in most cases their oi4Id
   * @param resource - the resource that is to be checked (health, license, etc...)
   */
  async checkResourceConformity(fullTopic: string, tag: string, resource: string): Promise<IValidityDetails> {
    let endTag = '';
    if (tag === '') {
      endTag = tag;
    } else {
      endTag = `/${tag}`;
    }
    const conformityPayload = this.builder.buildOPCUADataMessage({}, new Date, dscids[resource]);
    this.conformityClient.once('message', async (topic, rawMsg) => {
      await this.conformityClient.unsubscribe(`${fullTopic}/pub/${resource}${endTag}`);
      this.logger.log(`Received conformity message on ${resource} from ${tag}`, ESubResource.info);
      let errorMsg = 'ValidityError: ';
      if (topic === `${fullTopic}/pub/${resource}${endTag}`) {
        const parsedMessage = JSON.parse(rawMsg.toString()) as IOPCUAData;
        let eRes = 0;
        const schemaResult: ISchemaConformity = await this.checkSchemaConformity(resource, parsedMessage);
        if (schemaResult.schemaResult) { // Check if the schema validator threw any faults, schemaResult is an indicator for overall faults
          if (parsedMessage.CorrelationId === conformityPayload.MessageId) { // Check if the correlationId matches our messageId (according to guideline)
            eRes = EValidity.ok;
          } else {
            eRes = EValidity.partial;
            errorMsg = `${errorMsg} + CorrelationId did not pass for ${tag} with resource ${resource}`;
            this.logger.log(`CorrelationId did not pass for ${tag} with resource ${resource}`, ESubResource.error);
          }
        } else { // Oops, we have schema erros, let's show them to the user so they can fix them...
          this.logger.log(`Some errors with schema validation with tag: ${tag}`, ESubResource.error);
          errorMsg = `${errorMsg} + Some issue with schema validation: `;
          if (!(schemaResult.networkMessage.schemaResult)) { // NetworkMessage seems wrong
            this.logger.log('NetworkMessage wrong', ESubResource.warn);
            errorMsg = `${errorMsg} ${schemaResult.networkMessage.resultMsg} / `;
          }
          if (!(schemaResult.payload.schemaResult)) { // Payload seems wrong
            this.logger.log('Payload wrong', ESubResource.warn);
            errorMsg = `${errorMsg} ${schemaResult.payload.resultMsg} / `;
          }

          eRes = EValidity.partial;
        }

        if (!(parsedMessage.DataSetClassId === dscids[resource])) { // Check if the dataSetClassId matches our development guideline
          this.logger.log(`DataSetClassId did not pass for ${tag} with resource ${resource}`, ESubResource.error);
          errorMsg = `${errorMsg} + DataSetClassId did not pass for ${tag} with resource ${resource}`;
          eRes = EValidity.partial;
        }

        let resPayload;
        if (parsedMessage.MessageType === 'ua-data') {
          resPayload = parsedMessage.Messages[0].Payload;
        } else {
          resPayload = 'metadata';
        }

        const resObj: IValidityDetails = {
          validity: eRes,
          validityError: errorMsg,
          payload: resPayload, // We add the payload here in case we need to parse it later on (profile, licenseText for exmaple)
        };
        this.emit(`${resource}${fullTopic}Success`, resObj); // God knows how many hours I wasted here! We send the OI4ID with the success emit
        // This way, ONLY the corresponding Conformity gets updated!
      }
    });
    await this.conformityClient.subscribe(`${fullTopic}/pub/${resource}${endTag}`);
    await this.conformityClient.publish(`${fullTopic}/get/${resource}${endTag}`, JSON.stringify(conformityPayload));
    this.logger.log(`Trying to validate resource ${resource} on ${fullTopic}/get/${resource}${endTag} (Low-Level)`, ESubResource.info);
    return await promiseTimeout(new Promise((resolve, reject) => {
      this.once(`${resource}${fullTopic}Success`, (res) => {
        resolve(res);
      });
    }),
      700, /*tslint:disable-line*/ // 700ms as the timeout
      `checkResourceConformity-${resource}Error-onTopic-${fullTopic}/get/${resource}${endTag}`, /*tslint:disable-line*/
    );

  }

  /**
   * Checks the conformity of the payload by testing it against the correct schemas using the ajv library
   * Both the networkmessage and the actual payload are tested and only return a positive result if both passed
   * @param resource The resource that is being checked
   * @param payload  The payload that is being checked
   * @returns true, if both the networkmessage and the payload fit the resource, false otherwise
   */
  async checkSchemaConformity(resource: string, payload: any): Promise<ISchemaConformity> {
    let networkMessageValidationResult;
    let payloadValidationResult;

    let networkMessageResultMsg: string = '';
    let payloadResultMsg: string = '';

    try {
      networkMessageValidationResult = await this.jsonValidator.validate('NetworkMessage.schema.json', payload);
    } catch (networkMessageValidationErr) {
      this.logger.log(`AJV (Catch NetworkMessage): (${resource}):${networkMessageValidationErr}`, ESubResource.error);
      networkMessageResultMsg += JSON.stringify(networkMessageValidationErr);
      networkMessageValidationResult = false;
    }

    if (!networkMessageValidationResult) {
      const errText = JSON.stringify(this.jsonValidator.errors);
      this.logger.log(`AJV: NetworkMessage invalid (${resource}): ${errText}`, ESubResource.error);
      networkMessageResultMsg += errText;
    }

    if (networkMessageValidationResult) {
      if (payload.MessageType === 'ua-metadata') {
        payloadValidationResult = true; // We accept all metadata messages since we cannot check their contents
      } else { // Since it's a data message, we can check against schemas
        try {
          payloadValidationResult = await this.jsonValidator.validate(`${resource}.schema.json`, payload.Messages[0].Payload);
        } catch (payloadValidationErr) {
          this.logger.log(`AJV (Catch Payload): (${resource}):${payloadValidationErr}`, ESubResource.error);
          networkMessageResultMsg += JSON.stringify(payloadValidationErr);
          payloadValidationResult = false;
        }
        if (!payloadValidationResult) {
          const errText = JSON.stringify(this.jsonValidator.errors);
          this.logger.log(`AJV: Payload invalid (${resource}): ${errText}`, ESubResource.error);
          payloadResultMsg += errText;
        }
      }
    }

    const schemaConformity: ISchemaConformity = {
      schemaResult: false,
      networkMessage: {
        schemaResult: networkMessageValidationResult,
        resultMsg: networkMessageResultMsg,
      },
      payload: {
        schemaResult: payloadValidationResult,
        resultMsg: payloadResultMsg,
      },
    };

    if (networkMessageValidationResult && payloadValidationResult) {
      schemaConformity.schemaResult = true;
    } else {
      this.logger.log(`Faulty payload: ${JSON.stringify(payload)}`, ESubResource.warn);
    }

    return schemaConformity;
  }

  /**
   * Checks the full topic (including oi4/... preamble) for conformity.
   * @param topic - the full topic that is checked
   */
  static async checkTopicConformity(topic: string): Promise<boolean> {
    const topicArray = topic.split('/');
    if (topicArray.length >= 8) {
      let oi4String = '';
      for (let i = 0; i < 6; i = i + 1) {
        oi4String = `${oi4String}/${topicArray[i]}`;
      }
      if (!(ConformityValidator.serviceTypes.includes(topicArray[1]))) return false; // throw new Error('Unknown ServiceType');
      const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
      return await ConformityValidator.checkOI4IDConformity(oi4Id);
    } else { /*tslint:disable-line*/
      return false; // For minimum validity, we need oi4ID (length: 6) + method + method
    }
  }

  static async checkOI4IDConformity(oi4Id: string): Promise<boolean> {
    const oi4Array = oi4Id.split('/');
    if (oi4Array.length !== 4) return false; // throw new Error('Wrong number of subTopics');
    // further checks will follow!
    const oi4RegEx = new RegExp(/^urn:(?=.{4,255}$)([a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?\.){1,126}[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\/[^\/]+){3}$/g);
    if (oi4RegEx.test(oi4Id)) return true;
    console.log('Error in checkOI4IDConformity!');
    return false;
  }
}
