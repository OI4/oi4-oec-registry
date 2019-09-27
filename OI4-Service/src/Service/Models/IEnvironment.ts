// TODO: This needs to be moved to environment
export interface IEnvironmentManufacturer {
  name: string;
  tld: string;
}

export interface IEnvironmentAppID {
  manufacturer: IEnvironmentManufacturer;
  type: string;
  order: string;
  serial: string;
}
