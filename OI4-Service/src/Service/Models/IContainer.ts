import { IEnvironmentAppID } from './IEnvironment';
import { IOPCUAData, IOPCUAMetaData, IMasterAssetModel } from './IOPCUAPayload';

export interface IContainerInfo {
  serviceType: string;
  appID: IEnvironmentAppID;
}

export interface IEventObject {
  originId?: string;
  logLevel: string;
  logText: string;
}

export interface IContainerData {
  [key: string]: IOPCUAData; // TODO: should this really be an object? Maybe an array is better suited here.
}

export interface IContainerMetaData {
  [key: string]: IOPCUAMetaData;
}

export interface IContainerConfig {

}

export interface IContainerHealth {
  health: EDeviceHealth;
  healthState: number; // UInt16 (from 0 to 100%)
}

export interface IContainerEvent {
  number: number;
  description: string;
  payload: object;
}

export interface IContainerRTLicense {

}

export interface IContainerProfile {
  resource: string[];
}

export interface IComponentObject {
  component: string;
  licAuthor: string[];
  licAddText: string;
}

export interface ILicenseObject {
  licenseId: string;
  components: IComponentObject[];
}

export interface IContainerLicense {
  licenses: ILicenseObject[];
}

export interface IContainerLicenseText {
  [key: string]: string;
}

export interface IContainerPublicationList {
  publicationList: IPublicationListObject[];
}

export interface IContainerSubscriptionList {
  subscriptionList: ISubscriptionListObject[];
}

interface ISubscriptionListObject {
  topicPath: string;
  interval: number;
  config: ESubscriptionListConfig;
}

interface IPublicationListObject {
  tag: string;
  DataSetWriterId: string; // Actually OI4-Identifier: TODO: Validator
  status: boolean;
  interval: number;
  config: EPublicationListConfig;
}

export interface IContainerState {
  appId: string;
  health: IContainerHealth;
  license: IContainerLicense;
  licenseText: IContainerLicenseText;
  rtLicense: IContainerRTLicense;
  config: IContainerConfig;
  dataLookup: IContainerData;
  profile: IContainerProfile;
  metaDataLookup: IContainerMetaData;
  publicationList: IContainerPublicationList;
  subscriptionList: IContainerSubscriptionList;
  mam: IMasterAssetModel;

  // Methods
  addDataSet(dataname: string, data: IOPCUAData, metadata: IOPCUAMetaData): void;
}

export enum ESubResource {
  trace = 'trace',
  debug = 'debug',
  info = 'info',
  warn = 'warn',
  error = 'error',
  fatal = 'fatal',
}

export enum EDeviceHealth {
  NORMAL_0 = 'NORMAL_0',
  FAILURE_1 = 'FAILURE_1',
  CHECK_FUNCTION_2 = 'CHECK_FUNCTION_2',
  OFF_SPEC_3 = 'OFF_SPEC_3',
  MAINTENANCE_REQUIRED_4 = 'MAINTENANCE_REQUIRED_4',
}

export enum EPublicationListConfig {
  NONE_0 = 'NONE_0',
  STATUS_1 = 'STATUS_1',
  INTERVAL_2 = 'INTERVAL_2',
  STATUS_AND_INTERVAL_3 = 'STATUS_AND_INTERVAL_3',
}

export enum ESubscriptionListConfig {
  NONE_0 = 'NONE_0',
  CONF_1 = 'CONF_1',
  CREATE_2 = 'CREATE_2',
  DELETE_4 = 'DELETE_4',
}

export interface IDataSetClassIds {
  [key: string]: string;
  mam: string;
  health: string;
  license: string;
  licenseText: string;
  rtLicense: string;
  event: string;
  profile: string;
  config: string;
  publicationList: string;
  subscriptionList: string;
}
