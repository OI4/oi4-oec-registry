import {
  IOPCUAData,
  IOPCUAMetaData,
  IOPCUAMasterAssetModel,
  EOPCUAMessageType,
  EBuiltInType,
  IOPCUADataMessage,
  IOPCUAMetaDataMessage,
  IOPCUAFieldMetaData,
  EOPCUALocale,
  EValueRank,
} from '../../Models/IOPCUAPayload';

import uuid from 'uuid/v4'; /*tslint:disable-line*/

export interface IOPCUABuilderFieldProperties {
  [key: string]: IOPCUABuilderProps;
}

interface IOPCUABuilderProps {
  unit: string;
  description: string;
  type: EBuiltInType;
  min: number;
  max: number;
}

export class OPCUABuilder {
  appId: string;
  constructor(appId: string) {
    this.appId = appId;
  }

  /**
   * Builds an OPCUA and OI4-conform Data Message (Including NetworkMessage)
   * @param actualPayload - the payload that is to be encapsulated inside the OPCUA Packet (key-value pair of valid data)
   * @param timestamp - the current timestamp in Date format
   * @param classId - the DataSetClassId that is used for the data (health, license etc.)
   * @param correlationId - If the message is a response to a get, or a forward, input the MessageID of the request as the correlation id. Default: ''
   */
  buildOPCUADataMessage(actualPayload: any, timestamp: Date, classId: string, correlationId: string = ''): IOPCUAData {
    let opcUaDataPayload: IOPCUADataMessage[];
    // Not sure why empty objects were converted to an empty array. The correct behaviour is building an Empty DataSetMessage...
    // if (Object.keys(actualPayload).length === 0 && actualPayload.constructor === Object) {
    //   opcUaDataPayload = [];
    // } else {
    //   opcUaDataPayload = [this.buildOPCUAData(actualPayload, timestamp)];
    // }
    opcUaDataPayload = [this.buildOPCUAData(actualPayload, timestamp)];
    const opcUaDataMessage: IOPCUAData = {
      MessageId: `${Date.now().toString()}-${this.appId}`,
      MessageType: EOPCUAMessageType.uadata,
      DataSetClassId: classId, // TODO: Generate UUID, but not here, make a lookup,
      PublisherId: this.appId,
      Messages: opcUaDataPayload,
      CorrelationId: correlationId,
    };
    return opcUaDataMessage;
  }

  /**
   * Builds an OPCUA and OI4-conform MetaData Message (Including NetworkMessage)
   * @param metaDataName - the name of the dataset the metadata corresponds to
   * @param metaDataDescription - the description that is to be encapsulated in the metadata message
   * @param fieldProperties - the properties of each field. Currently consists of unit, description, type, min/max and valueRank. TODO: this is not finalized yet
   * @param timestamp - the current timestamp in Date format
   * @param classId - the DataSetClassId that is used for the data (health, license etc.)
   * @param correlationId - If the message is a response to a get, or a forward, input the MessageID of the request as the correlation id. Default: ''
   */
  buildOPCUAMetaDataMessage(metaDataName: string, metaDataDescription: string, fieldProperties: any, timestamp: Date, classId: string, correlationId: string = ''): IOPCUAMetaData {
    const opcUaMetaDataPayload: IOPCUAMetaDataMessage = this.buildOPCUAMetaData(metaDataName, metaDataDescription, classId, fieldProperties);
    const opcUaMetaDataMessage: IOPCUAMetaData = {
      MessageId: `${Date.now().toString()}-${this.appId}`,
      MessageType: EOPCUAMessageType.uametadata,
      PublisherId: this.appId,
      DataSetWriterId: 'somecompany.com/sensor/someid/someserial', // Currently hardcoded, originID
      MetaData: opcUaMetaDataPayload,
      CorrelationId: correlationId,
    };
    return opcUaMetaDataMessage;
  }

  /**
   * Encapsulates Payload inside "Messages" Object of OPCUAData
   * @param actualPayload - the payload (valid key-values) that is to be encapsulated
   * @param timestamp - the current timestamp in Date format
   */
  private buildOPCUAData(actualPayload: any, timestamp: Date): IOPCUADataMessage {
    const opcUaDataPayload: IOPCUADataMessage = { // TODO: More elements
      DataSetWriterId: this.appId,
      Timestamp: timestamp.toISOString(),
      Status: 0, // TODO switch to UASTATUSCODES
      Payload: actualPayload,
      MetaDataVersion: {
        majorVersion: 0,
        minorVersion: 0,
      },
    };
    return opcUaDataPayload;
  }

  // PropertyObject contains objects with name of property as key, and values: unit, description, builtInTypeype, min, max
  private buildOPCUAMetaData(metaDataName: string, metaDataDescription: string, classId: string, propertyObject: any): IOPCUAMetaDataMessage {
    const fieldArray: IOPCUAFieldMetaData[] = [];
    let fieldObject: IOPCUAFieldMetaData;
    for (const items of Object.keys(propertyObject)) {
      fieldObject = this.buildOPCUAMetaDataField(
        items,
        propertyObject[items].unit,
        propertyObject[items].description,
        propertyObject[items].type,
        propertyObject[items].min,
        propertyObject[items].max,
        propertyObject[items].valueRank,
      );
      fieldArray.push(fieldObject);
    }
    const metaDataObject: IOPCUAMetaDataMessage = {
      name: metaDataName,
      dataSetClassId: classId,
      configurationVersion: {
        majorVersion: 0,
        minorVersion: 0,
      },
      description: {
        Locale: EOPCUALocale.enUS,
        Text: metaDataDescription,
      },
      fields: fieldArray,
    };
    return metaDataObject;
  }

  // Hardcoded dataSetFieldId
  private buildOPCUAMetaDataField(key: string, unit: string, description: string, type: EBuiltInType, min: number, max: number, valueRank: number): IOPCUAFieldMetaData {
    const field = {
      valueRank,
      name: key,
      description: {
        Locale: EOPCUALocale.enUS,
        Text: description,
      },
      fieldFlags: 0, // Currently not parsed
      builtInType: type,
      dataType: { // Currently not parsed, should be the NodeID of builtInType
        IdType: 0,
        Id: 1,
      },
      arrayDimensions: [0], // Initial value, set later
      maxStringLength: 0, // Initial value, set later
      dataSetFieldId: uuid(), // TODO: Discuss which uuid needs to be here
      properties: [ // Partially hardcoded!
        {
          key: {
            Name: 'Unit',
            Uri: 0,
          },
          value: unit,
        },
        {
          key: {
            Name: 'Min',
            Uri: 0,
          },
          value: min,
        },
        {
          key: {
            Name: 'Max',
            Uri: 0,
          },
          value: max,
        },
      ],
    };
    if (type === EBuiltInType.String) {
      field.maxStringLength = max; // If The type is a string, we interpret min/max as string-length!
    }
    if (valueRank === EValueRank.Array) {
      field.arrayDimensions = [max];
    }
    if (valueRank === EValueRank.Matrix) {
      field.arrayDimensions = [min, max];
    }
    return field;
  }

  parseOPCUAData() {

  }

  parseOPCUAMetaData() {

  }

}
