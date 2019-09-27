export interface IConformity {
  oi4Id: EValidity;
  resource: IOI4TopicResource;
  validity: EValidity;
}

interface IOI4TopicResource {
  [key: string]: IOI4TopicValidity;
  license: IOI4TopicValidity;
  licenseText: IOI4TopicValidity;
  rtLicense: IOI4TopicValidity;
  data: IOI4TopicValidity;
  mam: IOI4TopicValidity;
  health: IOI4TopicValidity;
  config: IOI4TopicValidity;
  profile: IOI4TopicValidity;
}

interface IOI4TopicValidity {
  validity: EValidity;
  method: IOI4TopicMethod;
}

interface IOI4TopicMethod {
  [key: string]: EValidity;
  pub: EValidity;
  get: EValidity;
  // TODO: Add Set, Event etc. support
}

export enum EValidity {
  ok = 0,
  partial = 1,
  nok = 2,
}
