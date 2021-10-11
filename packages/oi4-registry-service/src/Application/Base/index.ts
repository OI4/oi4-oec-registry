import { OI4MessageBusProxy } from 'oi4-service-node/src/Proxy/Messagebus';
import { IOPCUANetworkMessage, IOPCUAMetaData } from 'oi4-service-node/src/Models/IOPCUA';
import { OPCUABuilder } from 'oi4-service-node/src/Utilities/OPCUABuilder';

import uuid from 'uuid/v4'; /*tslint:disable-line*/
import { ESyslogEventFilter } from 'oi4-service-node/src/Enums/EContainer';
import { EOPCUABuiltInType, EOPCUAValueRank } from 'oi4-service-node/src/Enums/EOPCUA';

export class BaseApplication {
  private msgProxy: OI4MessageBusProxy;
  private messageBuilder: OPCUABuilder;
  private weatherData: IOPCUANetworkMessage;
  private hostData: IOPCUANetworkMessage;
  private arrayData: IOPCUANetworkMessage;
  private matrixData: IOPCUANetworkMessage;
  private weatherDataGUID: string;
  private hostDataGUID: string;
  private arrayDataGUID: string;
  private matrixDataGUID: string;

  constructor(proxy: OI4MessageBusProxy) {
    this.msgProxy = proxy;
    this.messageBuilder = proxy.builder;
    this.weatherDataGUID = uuid();
    this.hostDataGUID = uuid();
    this.arrayDataGUID = uuid();
    this.matrixDataGUID = uuid();
    const boolArr = [];
    for (let i = 0; i < 2000; i = i + 1) {
      boolArr.push(Math.random() >= 0.5);
    }

    const arrMatrix = [];
    for (let i = 0; i < 10; i = i + 1) {
      const subArr = [];
      for (let i = 0; i < 2000; i = i + 1) {
        subArr.push(Math.random() >= 0.5);
      }
      arrMatrix.push(subArr);
    }

    this.weatherData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: { Temperature: 99, Humidity: '99' }, dswid: 1000 }], new Date(), this.weatherDataGUID);
    this.hostData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: { cpuLoad: '0', freeMemory: 0 }, dswid: 1000 }], new Date(), this.hostDataGUID);
    this.arrayData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: { myArr: boolArr }, dswid: 1000 }], new Date(), this.arrayDataGUID);
    this.matrixData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: { myMatrix: arrMatrix }, dswid: 1000 }], new Date(), this.matrixDataGUID);
  }

  // Base-Application! Just pump out different sets of data
  startBaseApp() {
    const weatherMetaDataProperties = {
      Temperature: {
        unit: '°C',
        description: 'Temperature of weather Data',
        type: EOPCUABuiltInType.Byte,
        min: 0,
        max: 100,
        valueRank: EOPCUAValueRank.Scalar,
      },
      Humidity: {
        unit: '%',
        description: 'Humidity of weather Data',
        type: EOPCUABuiltInType.String,
        min: 2,
        max: 4,
        valueRank: EOPCUAValueRank.Scalar,
      },
    };
    const hostMetaDataProperties = {
      cpuLoad: {
        unit: '%',
        description: 'CPU Load of HostData',
        type: EOPCUABuiltInType.Int64,
        min: 0,
        max: 100,
        valueRank: EOPCUAValueRank.Scalar,
      },
      freeMemory: {
        unit: 'MB',
        description: 'Currently used memory of HostData',
        type: EOPCUABuiltInType.Double,
        min: 0,
        max: 100,
        valueRank: EOPCUAValueRank.Scalar,
      },
    };
    const arrayDataProperties = {
      myArr: {
        unit: 'Lumberjack',
        description: 'Just a boolean Array to Test OPCUA-Conformity',
        type: EOPCUABuiltInType.Boolean,
        min: 0,
        max: 2000,
        valueRank: EOPCUAValueRank.Array,
      },
    };
    const matrixDataProperties = {
      myMatrix: {
        unit: 'Lumberjack',
        description: 'Just a boolena Matrix to Test OPCUA-Conformity',
        type: EOPCUABuiltInType.Boolean,
        min: 10,
        max: 2000,
        valueRank: EOPCUAValueRank.Matrix,
      },
    };
    const weatherMetaData: IOPCUAMetaData = this.messageBuilder.buildOPCUAMetaDataMessage(
      'weatherMetaData',
      'The MetaData of Weather',
      weatherMetaDataProperties,
      new Date(),
      this.weatherDataGUID,
    );
    const hostMetaData: IOPCUAMetaData = this.messageBuilder.buildOPCUAMetaDataMessage(
      'hostMetaData',
      'The MetaData of Host',
      hostMetaDataProperties,
      new Date(),
      this.hostDataGUID,
    );
    const arrayMetaData: IOPCUAMetaData = this.messageBuilder.buildOPCUAMetaDataMessage(
      'arrayMetaData',
      'The MetaData of Array',
      arrayDataProperties,
      new Date(),
      this.arrayDataGUID,
    );
    const matrixMetaData: IOPCUAMetaData = this.messageBuilder.buildOPCUAMetaDataMessage(
      'matrixMetaData',
      'The MetaData of Matrix',
      matrixDataProperties,
      new Date(),
      this.matrixDataGUID,
    );
    this.msgProxy.containerState.addDataSet('weatherData', this.weatherData, weatherMetaData);
    this.msgProxy.containerState.addDataSet('hostData', this.hostData, hostMetaData);
    this.msgProxy.containerState.addDataSet('arrayData', this.arrayData, arrayMetaData);
    this.msgProxy.containerState.addDataSet('matrixData', this.matrixData, matrixMetaData);

    setInterval(() => { this.msgProxy.sendData('hostData'); }, 10000);
    setInterval(() => { this.msgProxy.sendData('weatherData'); }, 10000);
    setInterval(() => { this.msgProxy.sendData('arrayData'); }, 10000);
    setInterval(() => { this.msgProxy.sendData('matrixData'); }, 10000);
    setInterval(() => { this.msgProxy.sendEvent(`Ping from ${this.msgProxy.oi4Id}: ${(Math.random() * 100).toString()} at ${new Date().toString()}`, ESyslogEventFilter.warning); }, 60000);
  }

  updateWeatherData() {
    const newTemp = Math.floor(Math.random() * Math.floor(100));
    const newHumidity = (Math.floor(Math.random() * Math.floor(100))).toString();
    this.weatherData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: {
      Temperature: newTemp,
      Humidity: newHumidity,
    }, dswid: 1000 }], new Date(), this.weatherDataGUID); /*tslint:disable-line*/
  }

  updateHostData() {
    const newLoad = Math.floor(Math.random() * Math.floor(100)).toString();
    const newMem = Math.floor(Math.random() * Math.floor(100));
    this.hostData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: {
      cpuLoad: newLoad,
      freeMemory: newMem,
    }, dswid: 1000 }], new Date(), this.hostDataGUID); /*tslint:disable-line*/
  }

  updateArrayData() {
    const boolArr = [];
    for (let i = 0; i < 2000; i = i + 1) {
      boolArr.push(Math.random() >= 0.5);
    }
    this.arrayData = this.messageBuilder.buildOPCUANetworkMessage([{ payload: {
      myArr: boolArr,
    }, dswid: 1000 }], new Date(), this.arrayDataGUID); /*tslint:disable-line*/
  }
}
