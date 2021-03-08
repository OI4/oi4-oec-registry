import { OI4MessageBusProxy } from '../../Service/src/Proxy/Messagebus/index';
import { IOPCUANetworkMessage, IOPCUAMetaData } from '../../Service/src/Models/IOPCUA';
import { OPCUABuilder } from '../../Service/src/Utilities/OPCUABuilder';

import uuid from 'uuid/v4'; /*tslint:disable-line*/
import { ESyslogEventFilter } from '../../Service/src/Models/IContainer';
import { EOPCUABuiltInType, EOPCUAValueRank } from '../../Service/src/Enums/EOPCUA';

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

    this.weatherData = this.messageBuilder.buildOPCUADataMessage([{ payload: { Temperature: 99, Humidity: '99' }}], new Date(), this.weatherDataGUID);
    this.hostData = this.messageBuilder.buildOPCUADataMessage([{ payload: { cpuLoad: '0', freeMemory: 0 }}], new Date(), this.hostDataGUID);
    this.arrayData = this.messageBuilder.buildOPCUADataMessage([{ payload: { myArr: boolArr }}], new Date(), this.arrayDataGUID);
    this.matrixData = this.messageBuilder.buildOPCUADataMessage([{ payload: { myMatrix: arrMatrix }}], new Date(), this.matrixDataGUID);
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
    this.weatherData = this.messageBuilder.buildOPCUADataMessage([{ payload: {
      Temperature: newTemp,
      Humidity: newHumidity,
    }}], new Date(), this.weatherDataGUID); /*tslint:disable-line*/
  }

  updateHostData() {
    const newLoad = Math.floor(Math.random() * Math.floor(100)).toString();
    const newMem = Math.floor(Math.random() * Math.floor(100));
    this.hostData = this.messageBuilder.buildOPCUADataMessage([{ payload: {
      cpuLoad: newLoad,
      freeMemory: newMem,
    }}], new Date(), this.hostDataGUID); /*tslint:disable-line*/
  }

  updateArrayData() {
    const boolArr = [];
    for (let i = 0; i < 2000; i = i + 1) {
      boolArr.push(Math.random() >= 0.5);
    }
    this.arrayData = this.messageBuilder.buildOPCUADataMessage([{ payload: {
      myArr: boolArr,
    }}], new Date(), this.arrayDataGUID); /*tslint:disable-line*/
  }
}
