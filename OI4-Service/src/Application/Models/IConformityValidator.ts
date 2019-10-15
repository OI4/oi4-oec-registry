export interface IConformity {
  oi4Id: EValidity;
  resource: IOI4TopicResource;
  profileResourceList: string[];
  validity: EValidity;
}

interface IOI4TopicResource {
  [key: string]: IOI4TopicValidity;
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
  default = 0,
  ok = 1,
  partial = 2,
  nok = 3,
}
